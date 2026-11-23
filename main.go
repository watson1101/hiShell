package main

import (
	"embed"
	"fmt"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/hongw/hishell/internal/sshx"
	"github.com/hongw/hishell/internal/store"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	sessionStore, err := store.NewSessionStore()
	if err != nil {
		log.Fatalf("初始化会话存储失败: %v", err)
	}

	app := NewApp(sessionStore)
	sshManager := sshx.NewManager(app.Emit)
	app.SetSSHManager(sshManager)

	err = wails.Run(&options.App{
		Title:            "hiShell",
		Width:            1360,
		Height:           860,
		MinWidth:         960,
		MinHeight:        640,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 24, G: 26, B: 32, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []interface{}{app},
	})
	if err != nil {
		fmt.Printf("启动失败: %v\n", err)
		log.Fatal(err)
	}
}
