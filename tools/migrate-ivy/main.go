// migrate-ivy 是一次性维护工具。旧格式仅存在于这里，不进入网页或服务接口。
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"ledger/internal/ledger"
)

type snapshot struct {
	App           string
	FormatVersion int
	DBUserVersion int
	ExportedAt    int64
	Tables        map[string][]map[string]any
}
type column struct {
	name, kind string
	nullable   bool
}
type table struct {
	name    string
	columns []column
}

var common = []column{{"id", "text", false}, {"name", "text", false}, {"color", "int", false}, {"icon", "text", true}, {"order_num", "number", false}, {"created_at", "int", false}, {"updated_at", "int", false}, {"is_delete", "int", false}}
var tables = []table{
	{"account", append(append([]column{}, common...), column{"initial_balance", "int", false}, column{"include_in_balance", "int", false}, column{"kind", "text", false}, column{"period_start", "int", true}, column{"period_end", "int", true}, column{"archived_at", "int", true})},
	{"category", append(append([]column{}, common...), column{"account_id", "text", false})},
	{"tag", common},
	{"txn", []column{{"id", "text", false}, {"type", "text", false}, {"amount", "int", false}, {"account_id", "text", false}, {"to_account_id", "text", true}, {"category_id", "text", true}, {"time", "int", false}, {"title", "text", true}, {"note", "text", true}, {"created_at", "int", false}, {"updated_at", "int", false}, {"is_delete", "int", false}}},
	{"txn_tag", []column{{"txn_id", "text", false}, {"tag_id", "text", false}}},
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	source := flag.String("source", "", "旧快照 JSON 路径")
	output := flag.String("out", "", "新 SQLite 路径，必须不存在")
	reportPath := flag.String("report", "", "对账 JSON 路径，必须不存在")
	commit := flag.String("source-commit", "", "源 Git commit，写入外部报告")
	flag.Parse()
	if *source == "" || *output == "" || *reportPath == "" || flag.NArg() != 0 {
		return fmt.Errorf("用法：go run ./tools/migrate-ivy --source <json> --out <新库> --report <报告> --source-commit <commit>")
	}
	for _, path := range []string{*output, *reportPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			return fmt.Errorf("目标必须不存在：%s", path)
		}
	}
	raw, err := os.ReadFile(*source)
	if err != nil {
		return err
	}
	snap, normalized, err := parseSnapshot(raw)
	if err != nil {
		return err
	}
	// 在旁边的临时目录构建并对账，成功后才以新路径发布；从不覆盖已有账本。
	parent := filepath.Dir(*output)
	if err = os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	temporary, err := os.MkdirTemp(parent, ".ledger-migrate-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	candidate := filepath.Join(temporary, "ledger.sqlite")
	store, err := ledger.Open(candidate, true)
	if err != nil {
		return err
	}
	store.Close()
	db, err := sql.Open("sqlite", candidate)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(1)
	defer db.Close()
	if _, err = db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, spec := range tables {
		names := []string{}
		for _, col := range spec.columns {
			names = append(names, col.name)
		}
		query := "INSERT INTO " + spec.name + "(" + strings.Join(names, ",") + ") VALUES(" + strings.TrimSuffix(strings.Repeat("?,", len(names)), ",") + ")"
		for index, row := range normalized[spec.name] {
			args := []any{}
			for _, name := range names {
				args = append(args, row[name])
			}
			if _, err = tx.Exec(query, args...); err != nil {
				return fmt.Errorf("%s 第 %d 行写入失败：%w", spec.name, index+1, err)
			}
		}
	}
	if err = validateRelations(tx); err != nil {
		return err
	}
	if err = verifyFields(tx, normalized); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if err = db.Close(); err != nil {
		return err
	}
	if err = ledger.CheckFile(context.Background(), candidate); err != nil {
		return err
	}
	audit, err := auditStatistics(candidate, normalized)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(raw)
	counts := map[string]any{}
	for _, spec := range tables {
		active := 0
		for _, row := range normalized[spec.name] {
			if row["is_delete"] == nil || row["is_delete"] == int64(0) {
				active++
			}
		}
		counts[spec.name] = map[string]int{"total": len(normalized[spec.name]), "active": active}
	}
	report := map[string]any{"sourceCommit": *commit, "sourceSHA256": hex.EncodeToString(hash[:]), "sourceExportedAt": snap.ExportedAt,
		"sourceDBVersion": snap.DBUserVersion, "targetDBVersion": 1, "counts": counts, "ignoredSettings": len(snap.Tables["setting"]),
		"checks": []string{"all persisted fields equal", "foreign keys valid", "integrity_check ok", "balances equal", "monthly and global summaries equal", "category totals equal"}, "audit": audit}
	reportBytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err = publish(candidate, *output); err != nil {
		return err
	}
	file, err := os.OpenFile(*reportPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("新库已创建，报告写入失败：%w", err)
	}
	_, err = file.Write(append(reportBytes, '\n'))
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	fmt.Printf("迁移完成：%d 笔交易（含删除），完整字段和统计对账通过。报告：%s\n", len(normalized["txn"]), *reportPath)
	return nil
}

func publish(source, destination string) error {
	// 同目录文件系统的硬链接带 O_EXCL 语义，避免检查后意外覆盖已有文件。
	return os.Link(source, destination)
}

func parseSnapshot(raw []byte) (snapshot, map[string][]map[string]any, error) {
	var snap snapshot
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&snap); err != nil {
		return snap, nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return snap, nil, fmt.Errorf("快照末尾存在额外内容")
	}
	if snap.App != "ivy-wallet" || snap.FormatVersion != 1 || snap.DBUserVersion != 3 {
		return snap, nil, fmt.Errorf("仅支持 ivy-wallet formatVersion=1 / dbUserVersion=3")
	}
	normalized := map[string][]map[string]any{}
	for _, spec := range tables {
		sourceRows, ok := snap.Tables[spec.name]
		if !ok || sourceRows == nil {
			return snap, nil, fmt.Errorf("缺少数组表 %s", spec.name)
		}
		rows := []map[string]any{}
		ids := map[string]bool{}
		for index, original := range sourceRows {
			row := map[string]any{}
			for _, col := range spec.columns {
				value, exists := original[col.name]
				if col.name == "is_delete" {
					value = int64(0)
					exists = true
					deleted, ok := original["deleted_at"]
					if !ok {
						return snap, nil, fmt.Errorf("%s 第 %d 行缺少 deleted_at", spec.name, index+1)
					}
					if deleted != nil {
						if _, err := convert(deleted, column{"deleted_at", "int", false}); err != nil {
							return snap, nil, err
						}
						value = int64(1)
					}
				}
				if col.name == "updated_at" && value == nil {
					value = original["created_at"]
					exists = true
				}
				if col.name == "kind" && value == nil {
					value = "normal"
					exists = true
				}
				if !exists {
					return snap, nil, fmt.Errorf("%s 第 %d 行缺少 %s", spec.name, index+1, col.name)
				}
				converted, err := convert(value, col)
				if err != nil {
					return snap, nil, fmt.Errorf("%s 第 %d 行：%w", spec.name, index+1, err)
				}
				row[col.name] = converted
			}
			if err := validateRow(spec.name, row); err != nil {
				return snap, nil, fmt.Errorf("%s 第 %d 行：%w", spec.name, index+1, err)
			}
			key, _ := row["id"].(string)
			if spec.name == "txn_tag" {
				key = row["txn_id"].(string) + "/" + row["tag_id"].(string)
			}
			if ids[key] {
				return snap, nil, fmt.Errorf("%s 第 %d 行主键重复", spec.name, index+1)
			}
			ids[key] = true
			rows = append(rows, row)
		}
		normalized[spec.name] = rows
	}
	return snap, normalized, nil
}

func convert(value any, col column) (any, error) {
	if value == nil && col.nullable {
		return nil, nil
	}
	switch col.kind {
	case "text":
		if text, ok := value.(string); ok {
			return text, nil
		}
	case "int":
		if number, ok := value.(int64); ok {
			return number, nil
		}
		if number, ok := value.(json.Number); ok {
			if v, err := number.Int64(); err == nil && v >= -ledger.MaxCents && v <= ledger.MaxCents {
				return v, nil
			}
		}
	case "number":
		if number, ok := value.(json.Number); ok {
			if v, err := number.Float64(); err == nil {
				return v, nil
			}
		}
	}
	return nil, fmt.Errorf("%s 类型或数值无效", col.name)
}

func validateRow(name string, row map[string]any) error {
	for key, value := range row {
		if (key == "id" || strings.HasSuffix(key, "_id")) && value != nil {
			id := value.(string)
			if strings.TrimSpace(id) == "" || len(id) > 200 {
				return fmt.Errorf("%s 无效", key)
			}
		}
		if (key == "time" || strings.HasSuffix(key, "_at") || key == "period_start" || key == "period_end") && value != nil {
			if _, err := ledger.ParseDate(ledger.DateOf(value.(int64))); err != nil {
				return fmt.Errorf("%s 时间超出支持范围", key)
			}
		}
	}
	if name == "account" || name == "category" || name == "tag" {
		if strings.TrimSpace(row["name"].(string)) == "" {
			return fmt.Errorf("名称为空")
		}
	}
	if name == "account" {
		if row["kind"] != "normal" && row["kind"] != "project" {
			return fmt.Errorf("账户类型无效")
		}
		if row["period_start"] != nil && row["period_end"] != nil && row["period_start"].(int64) > row["period_end"].(int64) {
			return fmt.Errorf("账户结束日期早于开始日期")
		}
	}
	if name == "txn" && row["type"] == "transfer" && row["category_id"] != nil {
		return fmt.Errorf("转账不应含分类")
	}
	return nil
}

func validateRelations(tx *sql.Tx) error {
	// SQLite 外键检查存在性；这里额外核对存活对象和分类归属。
	checks := []string{
		"SELECT COUNT(*) FROM category c JOIN account a ON a.id=c.account_id WHERE c.is_delete=0 AND a.is_delete=1",
		"SELECT COUNT(*) FROM txn t JOIN account a ON a.id=t.account_id LEFT JOIN account b ON b.id=t.to_account_id WHERE t.is_delete=0 AND (a.is_delete=1 OR b.is_delete=1)",
		"SELECT COUNT(*) FROM txn t JOIN category c ON c.id=t.category_id WHERE t.account_id<>c.account_id",
	}
	for _, query := range checks {
		var count int
		if err := tx.QueryRow(query).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("发现 %d 个无效关联，请核查快照后重新迁移", count)
		}
	}
	return nil
}
func verifyFields(tx *sql.Tx, normalized map[string][]map[string]any) error {
	for _, spec := range tables {
		names := []string{}
		for _, col := range spec.columns {
			names = append(names, col.name)
		}
		for _, expected := range normalized[spec.name] {
			where := "id=?"
			args := []any{expected["id"]}
			if spec.name == "txn_tag" {
				where = "txn_id=? AND tag_id=?"
				args = []any{expected["txn_id"], expected["tag_id"]}
			}
			actual := make([]any, len(names))
			dest := make([]any, len(names))
			for i := range actual {
				dest[i] = &actual[i]
			}
			if err := tx.QueryRow("SELECT "+strings.Join(names, ",")+" FROM "+spec.name+" WHERE "+where, args...).Scan(dest...); err != nil {
				return err
			}
			for i, col := range spec.columns {
				if !reflect.DeepEqual(actual[i], expected[col.name]) {
					return fmt.Errorf("字段对账失败：%s.%s", spec.name, col.name)
				}
			}
		}
	}
	return nil
}
