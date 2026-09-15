package ledger

import (
	"context"
	"crypto/rand"
	"database/sql"
	"database/sql/driver"
	"embed"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store 的唯一连接由 database/sql 管理；所有多步写入使用 sql.Tx。
type Store struct{ db *sql.DB }

var registerOnce sync.Once
var registerError error

func registerFunctions() error {
	registerOnce.Do(func() {
		registerError = sqlite.RegisterDeterministicScalarFunction("ledger_lower", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			if args[0] == nil {
				return "", nil
			}
			value, ok := args[0].(string)
			if !ok {
				return nil, fmt.Errorf("ledger_lower expects text")
			}
			return cases.Lower(language.Und).String(value), nil
		})
		if registerError != nil {
			return
		}
		registerError = sqlite.RegisterDeterministicScalarFunction("ledger_date", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			value, ok := args[0].(int64)
			if !ok {
				return nil, fmt.Errorf("ledger_date expects milliseconds")
			}
			return DateOf(value), nil
		})
	})
	return registerError
}

// Open 只有 create=true 才创建新库；正常服务启动不能把丢失的库变成空账本。
func Open(path string, create bool) (*Store, error) {
	if err := registerFunctions(); err != nil {
		return nil, err
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if create {
		if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
			return nil, err
		}
		file, e := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return nil, e
		}
		if e = file.Close(); e != nil {
			return nil, e
		}
	} else if info, e := os.Stat(absolute); e != nil {
		return nil, e
	} else if !info.Mode().IsRegular() || info.Size() == 0 {
		return nil, fmt.Errorf("数据库为空或不是普通文件：%s", absolute)
	}
	location := url.URL{Scheme: "file", Path: absolute}
	params := url.Values{"mode": {"rw"}, "_pragma": {"foreign_keys(1)", "busy_timeout(5000)", "journal_mode(WAL)", "synchronous(FULL)"}}
	location.RawQuery = params.Encode()
	db, err := sql.Open("sqlite", location.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Store{db: db}
	if err = store.initialize(create); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}
func (s *Store) initialize(create bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		return err
	}
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if create {
		schema, err := migrations.ReadFile("migrations/001_initial.sql")
		if err != nil {
			return err
		}
		if err = s.transaction(ctx, func(tx *sql.Tx) error { _, e := tx.ExecContext(ctx, string(schema)); return e }); err != nil {
			return err
		}
	} else if version != 1 {
		return fmt.Errorf("不支持的数据库版本 %d（当前为 1）", version)
	}
	var result string
	if err := s.db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("数据库检查失败：%s", result)
	}
	return nil
}
func (s *Store) Close() error                   { return s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *Store) transaction(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// querier 仅用于同一条读取在 DB/Tx 内复用，不是通用仓储抽象。
type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
func placeholders(count int) string { return strings.TrimSuffix(strings.Repeat("?,", count), ",") }
func affected(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return notFound()
	}
	return nil
}
func exists(ctx context.Context, q querier, table, id string) error {
	// table 只由下方固定业务调用提供，从不接受客户端表名。
	var found int
	err := q.QueryRowContext(ctx, "SELECT 1 FROM "+table+" WHERE id=? AND is_delete=0", id).Scan(&found)
	if err == sql.ErrNoRows {
		return notFound()
	}
	return err
}

type Info struct {
	Timezone      string  `json:"timezone"`
	Today         string  `json:"today"`
	EarliestMonth *string `json:"earliestMonth"`
}

func (s *Store) Info(ctx context.Context) (Info, error) {
	result := Info{Timezone: "Asia/Shanghai", Today: time.Now().In(Beijing).Format(time.DateOnly)}
	var earliest sql.NullInt64
	if err := s.db.QueryRowContext(ctx, "SELECT MIN(time) FROM txn WHERE is_delete=0").Scan(&earliest); err != nil {
		return result, err
	}
	if earliest.Valid {
		month := DateOf(earliest.Int64)[:7]
		result.EarliestMonth = &month
	}
	return result, nil
}
