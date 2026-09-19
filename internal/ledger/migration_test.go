package ledger

import (
	"crypto/sha256"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func legacyStore(t *testing.T) (*Store, string) {
	t.Helper()
	if err := registerFunctions(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "legacy.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	schema, err := os.ReadFile("testdata/schema_v1.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("PRAGMA foreign_keys=ON;" + string(schema)); err != nil {
		t.Fatal(err)
	}
	return &Store{db: db}, path
}

// 比较每个原始字段，包括已删除记录、归档状态、历史时间与图标。
func tableRows(t *testing.T, db *sql.DB, table string) [][]any {
	t.Helper()
	rows, err := db.Query("SELECT * FROM " + table + " ORDER BY 1")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		t.Fatal(err)
	}
	var result [][]any
	for rows.Next() {
		values, pointers := make([]any, len(columns)), make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err = rows.Scan(pointers...); err != nil {
			t.Fatal(err)
		}
		result = append(result, values)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestMigrateRemovesTagsAndPreservesLedger(t *testing.T) {
	old, source := legacyStore(t)
	a := account(t, old, "迁移日常", "normal", 10000)
	b := account(t, old, "迁移专项", "project", 2000)
	c, err := old.SaveCategory(testContext, "", CategoryInput{AccountID: a.ID, Name: "餐饮", Color: -1})
	if err != nil {
		t.Fatal(err)
	}
	expense := transaction(t, old, TransactionInput{Type: "expense", AccountID: a.ID, CategoryID: &c.ID, Amount: 1234, Date: "2026-09-01", Title: pointer("午餐"), Note: pointer("保留备注")})
	transaction(t, old, TransactionInput{Type: "income", AccountID: a.ID, Amount: 5000, Date: "2026-09-02"})
	transaction(t, old, TransactionInput{Type: "transfer", AccountID: a.ID, ToAccountID: &b.ID, Amount: 2000, Date: "2026-09-03"})
	deleted := transaction(t, old, TransactionInput{Type: "expense", AccountID: b.ID, Amount: 100, Date: "2026-09-04"})
	if err = old.DeleteTransaction(testContext, deleted.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = old.db.Exec(`INSERT INTO tag(id,name,color,icon,order_num,created_at,updated_at,is_delete) VALUES
 ('active','工作日',-1,'icon',0,10,20,0),('deleted','已删除',-2,NULL,1,11,21,1);
 UPDATE account SET archived_at=12345 WHERE kind='project';
 UPDATE txn SET time=time+123456;`); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{expense.ID, deleted.ID} {
		if _, err = old.db.Exec("INSERT INTO txn_tag(txn_id,tag_id) VALUES(?,'active'),(?,'deleted')", id, id); err != nil {
			t.Fatal(err)
		}
	}
	snapshots := map[string][][]any{}
	for _, table := range []string{"account", "category", "txn"} {
		snapshots[table] = tableRows(t, old.db, table)
	}
	beforeAccounts, err := old.Accounts(testContext)
	if err != nil {
		t.Fatal(err)
	}
	beforeSummary, err := old.Summary(testContext, SummaryQuery{})
	if err != nil {
		t.Fatal(err)
	}
	old.Close()
	before, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "upgraded.sqlite")
	if err = Migrate(testContext, source, destination); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(source)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("migration changed source", err)
	}
	store, err := Open(destination, false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for table, want := range snapshots {
		if got := tableRows(t, store.db, table); !reflect.DeepEqual(got, want) {
			t.Fatalf("migration changed %s rows", table)
		}
	}
	var count int
	if err = store.db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE name IN ('tag','txn_tag','txn_tag_tag')").Scan(&count); err != nil || count != 0 {
		t.Fatal("tag schema remains", count, err)
	}
	gotAccounts, err := store.Accounts(testContext)
	if err != nil || !reflect.DeepEqual(gotAccounts, beforeAccounts) {
		t.Fatal("balances changed", err)
	}
	gotSummary, err := store.Summary(testContext, SummaryQuery{})
	if err != nil || !reflect.DeepEqual(gotSummary, beforeSummary) {
		t.Fatal("summary changed", err)
	}
	if err = CheckFile(testContext, destination); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(testContext, source, destination); err == nil {
		t.Fatal("migration overwrote destination")
	}
	if err = Migrate(testContext, source, source); err == nil {
		t.Fatal("migration overwrote source")
	}
	if err = CheckFile(testContext, source); err == nil {
		t.Fatal("deployment check accepted an unmigrated database")
	}
	if s, err := Open(source, false); err == nil {
		s.Close()
		t.Fatal("serve accepted legacy schema")
	} else if !strings.Contains(err.Error(), "migrate") {
		t.Fatal("missing upgrade guidance", err)
	}
	copy := filepath.Join(t.TempDir(), "legacy-restored.sqlite")
	if err = Restore(testContext, source, copy); err != nil {
		t.Fatal(err)
	}
	if err = checkFile(testContext, copy, 1); err != nil {
		t.Fatal("restore must preserve source schema", err)
	}
}

func TestMigrationFailureRollsBackSchema(t *testing.T) {
	old, source := legacyStore(t)
	if _, err := old.db.Exec(`INSERT INTO tag(id,name,color,order_num,created_at,updated_at) VALUES('used','保留',-1,0,0,0);
 CREATE TABLE extra_reference(id TEXT REFERENCES tag(id));
 INSERT INTO extra_reference VALUES('used');`); err != nil {
		t.Fatal(err)
	}
	old.Close()
	destination := filepath.Join(t.TempDir(), "failed.sqlite")
	if err := Migrate(testContext, source, destination); err == nil {
		t.Fatal("unexpected foreign key dependency accepted")
	}
	for _, path := range []string{source, destination} {
		if err := checkFile(testContext, path, 1); err != nil {
			t.Fatal("failed migration left partial schema", err)
		}
	}
}

func TestMigrateRejectsMissingAndCurrentSources(t *testing.T) {
	directory := t.TempDir()
	source, destination := filepath.Join(directory, "source.sqlite"), filepath.Join(directory, "destination.sqlite")
	if err := Migrate(testContext, source, destination); err == nil {
		t.Fatal("accepted missing source")
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("created destination for missing source")
	}
	store, err := Open(source, true)
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	if err = Migrate(testContext, source, destination); err == nil {
		t.Fatal("accepted already upgraded source")
	}
}
