package ledger

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
	Line    int    `json:"line,omitempty"`
}

func (e *Error) Error() string { return e.Message }
func invalid(field, message string) error {
	return &Error{Code: "VALIDATION", Field: field, Message: message}
}
func notFound() error { return &Error{Code: "NOT_FOUND", Message: "记录不存在或已删除"} }
func safeCents(value int64) error {
	if value > MaxCents || value < -MaxCents {
		return invalid("amount", "金额合计超出安全范围")
	}
	return nil
}
func addCents(a, b int64) (int64, error) {
	if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
		return 0, invalid("amount", "金额合计溢出")
	}
	v := a + b
	return v, safeCents(v)
}
func validateName(name string, color int64) error {
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 100 {
		return invalid("name", "名称须为 1 至 100 个字符")
	}
	if color < -2147483648 || color > 4294967295 {
		return invalid("color", "颜色无效")
	}
	return nil
}
func validateText(field string, value *string, max int) error {
	if value != nil && utf8.RuneCountInString(*value) > max {
		return invalid(field, fmt.Sprintf("最多 %d 个字符", max))
	}
	return nil
}
func uniqueIDs(ids []string) ([]string, error) {
	if len(ids) > 500 {
		return nil, invalid("ids", "一次最多 500 个 ID")
	}
	result := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || len(id) > 100 {
			return nil, invalid("ids", "ID 无效")
		}
		if !seen[id] {
			result = append(result, id)
			seen[id] = true
		}
	}
	return result, nil
}
