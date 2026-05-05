package approval

import (
	"embed"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
)

//go:embed admin_static
var adminFiles embed.FS

var adminAssetsFS = mustSubFS(adminFiles, "admin_static/assets")
var adminAssetServer = http.StripPrefix("/assets/", http.FileServer(http.FS(adminAssetsFS)))

func mustSubFS(files embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(files, dir)
	if err != nil {
		panic(err)
	}
	return sub
}

func (a *API) admin(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	index, err := adminFiles.ReadFile("admin_static/index.html")
	if err != nil {
		http.Error(w, "admin dashboard is not built", http.StatusInternalServerError)
		return
	}

	page := strings.NewReplacer(
		`"__MODE__"`, strconv.Quote(a.mode),
		`"__PUBLIC_URL__"`, strconv.Quote(a.publicURL),
	).Replace(string(index))

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(page))
}

func (a *API) adminAsset(w http.ResponseWriter, r *http.Request) {
	if (r.Method != http.MethodGet && r.Method != http.MethodHead) || !strings.HasPrefix(r.URL.Path, "/assets/") {
		http.NotFound(w, r)
		return
	}
	assetPath := strings.TrimPrefix(r.URL.Path, "/assets/")
	if !fs.ValidPath(assetPath) {
		http.NotFound(w, r)
		return
	}
	file, err := adminAssetsFS.Open(assetPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || stat.IsDir() {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	adminAssetServer.ServeHTTP(w, r)
}
