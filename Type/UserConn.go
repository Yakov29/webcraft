package Type

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"madcraft.io/madcraft/Struct"
	"madcraft.io/madcraft/utils/conf"
)

type (
	// UserConn ...
	UserConn struct {
		Session          *Struct.UserSession
		ID               string // уникальный GUID пользователя
		Skin             string
		Rotate           Struct.Vector3f
		Pos              Struct.Vector3f
		PosSpawn         Struct.Vector3f
		ChunkPos         Struct.Vector3
		ChunkPosO        Struct.Vector3
		ChunkRenderDist  int
		Ws               *websocket.Conn
		Mu               *sync.Mutex          // чтобы избежать коллизий записи в сокет
		Join             chan *websocket.Conn // Register requests from the connections.
		Time             time.Time            // Время соединения, time.Now()
		LastInPacketTime time.Time            // Время, когда была последняя активность от игрока по вебсокету
		Leave            chan *websocket.Conn // Unregister requests from connections.
		Closed           bool
		World            *World
	}
)

// Run in goroutine
func (this *UserConn) Close() {
	this.Closed = true
}

// Run in goroutine
func (this *UserConn) Receiver() {

	this.Mu = &sync.Mutex{}
	this.Time = time.Now()

	// Send HELO
	this.SendHelo()

	for {
		if this.Closed {
			goto Exit
		}
		_, command, err := this.Ws.ReadMessage()
		if err != nil {
			log.Println("************** UserConn.Receiver().ReadMessage() ERROR", err)
			goto Exit
		}
		// Входящая команда от пользователя на сервер
		// commandString := string(command)
		// log.Printf("commandString: " + commandString)
		// Command ... Входящая команда от пользователя на сервер
		// func (ur *UserRoom) Command(command string, uConn *UserConn) {
		var cmdIn Struct.Command
		err = json.Unmarshal([]byte(command), &cmdIn)
		if err == nil {
			this.LastInPacketTime = time.Now()
			// log.Println("-> CMD:", cmdIn.Name, "From:", this.ID)
			switch cmdIn.Name {
			case Struct.CMD_CONNECT:
				if this.World != nil {
					// @todo
					log.Println("Сперва нужно выйти из предыдущего мира")
				} else {
					// разбор входных параметров
					out, _ := json.Marshal(cmdIn.Data)
					var param *Struct.CmdConnect
					json.Unmarshal(out, &param)
					log.Printf("Connect to world ID: %s", param.WorldGUID)
					//
					this.World = Worlds.Get(param.WorldGUID)
					this.World.OnPlayer(this)
				}
			case Struct.CMD_PING:
				this.SendPong()
			case Struct.CMD_DATA:
				// do nothing
			default:
				if this.World == nil {
					// @todo
					log.Println("Сперва нужно войти в мир")
				} else {
					this.World.OnCommand(cmdIn, this)
				}
			}
		} else {
			// @todo
			log.Println("Ошибка разбора входящей команды")
		}
	}
Exit:
	if this.World != nil {
		this.World.PlayerLeave(this)
	}
	this.Closed = true
}

func (this *UserConn) SendHelo() {
	packet := Struct.JSONResponse{Name: Struct.CMD_MSG_HELLO, Data: "Welcome to " + conf.Config.AppCode + " ver. " + conf.Config.AppVersion, ID: nil}
	packets := []Struct.JSONResponse{packet}
	this.WriteJSON(packets)
}

func (this *UserConn) SendPong() {
	packet := Struct.JSONResponse{Name: Struct.CMD_PONG, Data: nil, ID: nil}
	packets := []Struct.JSONResponse{packet}
	this.WriteJSON(packets)
}

// Отправка содержимого сундука
func (this *UserConn) SendChest(chest *Chest) {
	packet := Struct.JSONResponse{Name: Struct.CMD_CHEST_CONTENT, Data: chest, ID: nil}
	packets := []Struct.JSONResponse{packet}
	this.WriteJSON(packets)
}

func (this *UserConn) WriteJSON(packets []Struct.JSONResponse) {
	this.Mu.Lock()
	defer this.Mu.Unlock()
	this.Ws.WriteJSON(packets)
}
