package ledger

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
)

// CheckFile 以只读方式检查备份，不改变它的 journal 模式或创建新库。
func CheckFile(ctx context.Context, path string) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	location := url.URL{Scheme: "file", Path: absolute, RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", location.String())
	if err != nil {
		return err
	}
	defer db.Close()
	var version int
	if err = db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version != 1 {
		return fmt.Errorf("不支持的数据库版本 %d", version)
	}
	var result string
	if err = db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("数据库完整性检查失败：%s", result)
	}
	rows, err := db.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return fmt.Errorf("数据库存在失效外键")
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, table := range []string{"account", "category", "tag", "txn", "txn_tag"} {
		var count int
		if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil {
			return err
		}
	}
	return nil
}

// Backup 使用 SQLite 的一致性快照，包含已提交 WAL 数据；目标文件必须不存在。
func (s *Store) Backup(ctx context.Context, destination string) (err error) {
	absolute, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return err
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.Remove(absolute)
		}
	}()
	if _, err = s.db.ExecContext(ctx, "VACUUM INTO ?", absolute); err != nil {
		return err
	}
	return CheckFile(ctx, absolute)
}

// Restore 只生成一份新的数据库，正式替换由停服维护流程完成。
func Restore(ctx context.Context, source, destination string) error {
	if err := CheckFile(ctx, source); err != nil {
		return err
	}
	absolute, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	location := url.URL{Scheme: "file", Path: absolute, RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", location.String())
	if err != nil {
		return err
	}
	defer db.Close()
	return (&Store{db: db}).Backup(ctx, destination)
}
