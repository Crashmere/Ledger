-- 只在显式生成的升级副本中执行；账户、分类和交易原样保留。
DROP TABLE txn_tag;
DROP TABLE tag;
PRAGMA user_version = 2;
