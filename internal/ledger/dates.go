package ledger

import (
	"time"
	_ "time/tzdata"
)

var Beijing = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		panic(err)
	}
	return loc
}()

func DateOf(ms int64) string { return time.UnixMilli(ms).In(Beijing).Format(time.DateOnly) }
func ParseDate(value string) (time.Time, error) {
	t, err := time.ParseInLocation(time.DateOnly, value, Beijing)
	if err != nil || t.Year() < 1900 || t.Year() > 9998 {
		return time.Time{}, invalid("date", "日期须为 1900 至 9998 年间的 YYYY-MM-DD")
	}
	return t, nil
}
func optionalDate(value *string) (*int64, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	t, err := ParseDate(*value)
	if err != nil {
		return nil, err
	}
	ms := t.UnixMilli()
	return &ms, nil
}
