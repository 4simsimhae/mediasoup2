const express = require("express");
const app = express();
const https = require('httpolyglot');
const fs = require('fs');
// const server = require("http").Server(app);
const { v4: uuidv4 } = require("uuid");

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
  cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
  }

const httpsServer = https.createServer(options, app)
httpsServer.listen(3000, () => {
  console.log('listening on port: ' + 3000)
})

// Peer

const { ExpressPeerServer } = require("peer");
const peerServer = ExpressPeerServer(httpsServer, {
  debug: true,
});

const io = require('socket.io')(httpsServer, {
  cors: {
      origin: [
          'https://simsimhae.store',
          'http://localhost:3000',
          'https://front-black-delta.vercel.app',
          'https://testmedia.vercel.app',
      ],
      credentials: true,
  },
});

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use("/peerjs", peerServer);

app.get("/", (req, rsp) => {
  rsp.redirect(`/${uuidv4()}`);
});

app.get("/:room", (req, res) => {
  res.render("room", { roomId: req.params.room });
});

io.on("connection", (socket) => {
  socket.on("join-room", (roomId, userId) => {
    socket.join(roomId);
    socket.to(roomId).broadcast.emit("user-connected", userId);

    socket.on("message", (message) => {
      io.to(roomId).emit("createMessage", message);
    });
  });
});

// server.listen(process.env.PORT || 3000);
