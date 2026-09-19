-- 金额单位为分，时间单位为 epoch 毫秒。删除只改变 is_delete。
CREATE TABLE account (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 color INTEGER NOT NULL, icon TEXT,
 initial_balance INTEGER NOT NULL DEFAULT 0 CHECK(abs(initial_balance) <= 9007199254740991),
 include_in_balance INTEGER NOT NULL DEFAULT 1 CHECK(include_in_balance IN (0,1)),
 order_num REAL NOT NULL, kind TEXT NOT NULL DEFAULT 'normal' CHECK(kind IN ('normal','project')),
 period_start INTEGER, period_end INTEGER, archived_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 is_delete INTEGER NOT NULL DEFAULT 0 CHECK(is_delete IN (0,1))
);
CREATE TABLE category (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
 name TEXT NOT NULL CHECK(length(trim(name)) > 0), color INTEGER NOT NULL, icon TEXT,
 order_num REAL NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 is_delete INTEGER NOT NULL DEFAULT 0 CHECK(is_delete IN (0,1))
);
CREATE TABLE txn (
 id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('income','expense','transfer')),
 amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 9007199254740991),
 account_id TEXT NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
 to_account_id TEXT REFERENCES account(id) ON DELETE RESTRICT,
 category_id TEXT REFERENCES category(id) ON DELETE SET NULL,
 time INTEGER NOT NULL, title TEXT, note TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 is_delete INTEGER NOT NULL DEFAULT 0 CHECK(is_delete IN (0,1)),
 CHECK((type = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id)
    OR (type <> 'transfer' AND to_account_id IS NULL))
);
CREATE INDEX category_account ON category(account_id,order_num) WHERE is_delete=0;
CREATE INDEX txn_time ON txn(time,created_at,id) WHERE is_delete=0;
CREATE INDEX txn_account_time ON txn(account_id,time,created_at,id) WHERE is_delete=0;
CREATE INDEX txn_to_account_time ON txn(to_account_id,time,created_at,id) WHERE is_delete=0;
CREATE INDEX txn_category_time ON txn(category_id,time,created_at,id) WHERE is_delete=0;
CREATE INDEX txn_amount ON txn(amount,created_at,id) WHERE is_delete=0;
PRAGMA user_version = 2;
