// Package httpapi 把 HTTP/JSON 转为 ledger 方法调用，不包含记账计算。
package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"ledger/internal/ledger"
)

type Server struct {
	store  *ledger.Store
	assets fs.FS
}

func New(store *ledger.Store, assets fs.FS) http.Handler {
	s := &Server{store: store, assets: assets}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := store.Ping(r.Context()); err != nil {
			respondError(w, err)
			return
		}
		respond(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/ledger/info", func(w http.ResponseWriter, r *http.Request) { v, e := store.Info(r.Context()); reply(w, v, e) })
	mux.HandleFunc("GET /api/accounts", func(w http.ResponseWriter, r *http.Request) { v, e := store.Accounts(r.Context()); reply(w, v, e) })
	mux.HandleFunc("GET /api/categories", func(w http.ResponseWriter, r *http.Request) {
		v, e := store.Categories(r.Context(), r.URL.Query().Get("accountId"))
		reply(w, v, e)
	})
	mux.HandleFunc("GET /api/tags", func(w http.ResponseWriter, r *http.Request) { v, e := store.Tags(r.Context()); reply(w, v, e) })
	mux.HandleFunc("GET /api/transactions/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, e := store.Transaction(r.Context(), r.PathValue("id"))
		reply(w, v, e)
	})
	mux.HandleFunc("POST /api/transactions/query", func(w http.ResponseWriter, r *http.Request) {
		var input ledger.TransactionQuery
		if !decode(w, r, &input) {
			return
		}
		v, e := store.QueryTransactions(r.Context(), input)
		reply(w, v, e)
	})
	mux.HandleFunc("POST /api/statistics/summary", func(w http.ResponseWriter, r *http.Request) {
		var input ledger.SummaryQuery
		if !decode(w, r, &input) {
			return
		}
		v, e := store.Summary(r.Context(), input)
		reply(w, v, e)
	})
	mux.HandleFunc("POST /api/statistics/categories", func(w http.ResponseWriter, r *http.Request) {
		var input ledger.CategoryQuery
		if !decode(w, r, &input) {
			return
		}
		v, e := store.CategoryStatistics(r.Context(), input)
		reply(w, v, e)
	})
	mux.HandleFunc("POST /api/statistics/daily", func(w http.ResponseWriter, r *http.Request) {
		var input ledger.DailyQuery
		if !decode(w, r, &input) {
			return
		}
		v, e := store.DailyStatistics(r.Context(), input)
		reply(w, v, e)
	})
	mux.HandleFunc("POST /api/transactions/batch/preview", func(w http.ResponseWriter, r *http.Request) {
		var input ledger.BatchRequest
		if !decode(w, r, &input) {
			return
		}
		v, e := store.PreviewBatch(r.Context(), input)
		reply(w, v, e)
	})
	mux.HandleFunc("POST /api/transactions/batch", func(w http.ResponseWriter, r *http.Request) {
		var input ledger.BatchRequest
		if !decode(w, r, &input) {
			return
		}
		v, e := store.SaveBatch(r.Context(), input)
		reply(w, v, e)
	})
	mux.HandleFunc("POST /api/accounts/reorder", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			IDs []string `json:"ids"`
		}
		if !decode(w, r, &input) {
			return
		}
		reply(w, map[string]bool{"ok": true}, store.ReorderAccounts(r.Context(), input.IDs))
	})
	mux.HandleFunc("POST /api/accounts/{id}/categories/reorder", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			IDs []string `json:"ids"`
		}
		if !decode(w, r, &input) {
			return
		}
		reply(w, map[string]bool{"ok": true}, store.ReorderCategories(r.Context(), r.PathValue("id"), input.IDs))
	})
	mux.HandleFunc("POST /api/accounts", s.saveAccount)
	mux.HandleFunc("PUT /api/accounts/{id}", s.saveAccount)
	mux.HandleFunc("POST /api/categories", s.saveCategory)
	mux.HandleFunc("PUT /api/categories/{id}", s.saveCategory)
	mux.HandleFunc("POST /api/tags", s.saveTag)
	mux.HandleFunc("PUT /api/tags/{id}", s.saveTag)
	mux.HandleFunc("POST /api/transactions", s.saveTransaction)
	mux.HandleFunc("PUT /api/transactions/{id}", s.saveTransaction)
	mux.HandleFunc("DELETE /api/accounts/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]bool{"ok": true}, store.DeleteAccount(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("DELETE /api/categories/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]bool{"ok": true}, store.DeleteCategory(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("DELETE /api/tags/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]bool{"ok": true}, store.DeleteTag(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("DELETE /api/transactions/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]bool{"ok": true}, store.DeleteTransaction(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("/api", apiNotFound)
	mux.HandleFunc("/api/", apiNotFound)
	mux.HandleFunc("/", s.static)
	return s.middleware(mux)
}
func (s *Server) saveAccount(w http.ResponseWriter, r *http.Request) {
	var input ledger.AccountInput
	if !decode(w, r, &input) {
		return
	}
	v, e := s.store.SaveAccount(r.Context(), r.PathValue("id"), input)
	reply(w, v, e)
}
func (s *Server) saveCategory(w http.ResponseWriter, r *http.Request) {
	var input ledger.CategoryInput
	if !decode(w, r, &input) {
		return
	}
	v, e := s.store.SaveCategory(r.Context(), r.PathValue("id"), input)
	reply(w, v, e)
}
func (s *Server) saveTag(w http.ResponseWriter, r *http.Request) {
	var input ledger.NamedInput
	if !decode(w, r, &input) {
		return
	}
	v, e := s.store.SaveTag(r.Context(), r.PathValue("id"), input)
	reply(w, v, e)
}
func (s *Server) saveTransaction(w http.ResponseWriter, r *http.Request) {
	var input ledger.TransactionInput
	if !decode(w, r, &input) {
		return
	}
	v, e := s.store.SaveTransaction(r.Context(), r.PathValue("id"), input)
	reply(w, v, e)
}
func decode(w http.ResponseWriter, r *http.Request, dest any) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		respondError(w, &ledger.Error{Code: "VALIDATION", Message: "请求须为 application/json"})
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	var raw json.RawMessage
	if err = decoder.Decode(&raw); err != nil {
		respondError(w, &ledger.Error{Code: "VALIDATION", Message: "JSON 格式或字段无效"})
		return false
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		respondError(w, &ledger.Error{Code: "VALIDATION", Message: "请求只能包含一个 JSON 对象"})
		return false
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil || fields == nil {
		respondError(w, &ledger.Error{Code: "VALIDATION", Message: "请求须为 JSON 对象"})
		return false
	}
	// 写入是完整表单更新。缺字段不能被 Go 零值悄悄覆盖为 0、false 或空数组。
	var required []string
	switch dest.(type) {
	case *ledger.AccountInput:
		required = []string{"name", "color", "initialBalance", "includeInBalance", "kind", "periodStart", "periodEnd", "archived"}
	case *ledger.CategoryInput:
		required = []string{"name", "color"}
		if r.Method == "POST" {
			required = append(required, "accountId")
		}
	case *ledger.NamedInput:
		required = []string{"name", "color"}
	case *ledger.TransactionInput:
		required = []string{"type", "amount", "accountId", "toAccountId", "categoryId", "date", "title", "note", "tagIds"}
	}
	for _, field := range required {
		value, exists := fields[field]
		nullable := field == "periodStart" || field == "periodEnd" || field == "toAccountId" || field == "categoryId" || field == "title" || field == "note"
		if !exists || (!nullable && bytes.Equal(bytes.TrimSpace(value), []byte("null"))) {
			respondError(w, &ledger.Error{Code: "VALIDATION", Field: field, Message: "缺少必填字段：" + field})
			return false
		}
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(dest); err != nil {
		respondError(w, &ledger.Error{Code: "VALIDATION", Message: "JSON 格式或字段无效"})
		return false
	}
	return true
}
func reply(w http.ResponseWriter, value any, err error) {
	if err != nil {
		respondError(w, err)
		return
	}
	respond(w, http.StatusOK, value)
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write response", "error", err)
	}
}
func respondError(w http.ResponseWriter, err error) {
	var domain *ledger.Error
	status := http.StatusInternalServerError
	if errors.As(err, &domain) {
		switch domain.Code {
		case "VALIDATION":
			status = 400
		case "NOT_FOUND":
			status = 404
		case "RESTRICT":
			status = 409
		}
	} else {
		slog.Error("request failed", "error", err)
		domain = &ledger.Error{Code: "INTERNAL", Message: "服务暂时不可用，请稍后重试"}
	}
	respond(w, status, map[string]any{"error": domain})
}
func apiNotFound(w http.ResponseWriter, r *http.Request) {
	respond(w, 404, map[string]any{"error": ledger.Error{Code: "NOT_FOUND", Message: "接口不存在"}})
}
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != "GET" && r.Method != "HEAD" {
			origin := r.Header.Get("Origin")
			if origin != "" {
				u, e := url.Parse(origin)
				scheme := "http"
				if r.TLS != nil {
					scheme = "https"
				}
				if e != nil || u.Host != r.Host || u.Scheme != scheme {
					respond(w, 403, map[string]any{"error": ledger.Error{Code: "ORIGIN", Message: "不允许跨站请求"}})
					return
				}
			}
		}
		start := time.Now()
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("handler panic", "path", r.URL.Path, "error", recovered)
				respondError(w, errors.New("internal panic"))
			}
			slog.Debug("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
		}()
		next.ServeHTTP(w, r)
	})
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		http.Error(w, "method not allowed", 405)
		return
	}
	if s.assets == nil {
		http.Error(w, "前端尚未构建，请运行 npm --prefix web run build", 503)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	data, err := fs.ReadFile(s.assets, name)
	if err != nil {
		// 仅页面地址回退；拼错 JS/CSS 必须是 404，不能返回 HTML。
		if strings.HasPrefix(name, "assets/") || path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
		data, err = fs.ReadFile(s.assets, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	if name == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if r.Method != "HEAD" {
		_, _ = w.Write(data)
	}
}
