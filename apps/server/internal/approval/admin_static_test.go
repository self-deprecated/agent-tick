package approval

import (
	"os"
	"regexp"
	"testing"
)

func TestAdminStaticIndexReferencesExistingAssets(t *testing.T) {
	data, err := os.ReadFile("admin_static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(index.html) error = %v", err)
	}
	re := regexp.MustCompile(`/(assets/[^"']+)`)
	matches := re.FindAllSubmatch(data, -1)
	if len(matches) == 0 {
		t.Fatalf("index.html did not reference any assets")
	}
	for _, match := range matches {
		path := "admin_static/" + string(match[1])
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("referenced asset %s is missing: %v", path, err)
		}
	}
}
