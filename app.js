/**
 * integrating mediasoup server with a node.js application
 */

/* Please follow mediasoup installation requirements */
/* https://mediasoup.org/documentation/v3/mediasoup/installation/ */

const express = require ('express');
const app = express()

const https = require('httpolyglot');
const fs = require('fs');
const path = require('path')
const _dirname = path.resolve()

const { Server } = require('socket.io');
const mediasoup = require('mediasoup');

app.get('/', (req, res) => {
  res.send('Hello from mediasoup app!')
})

//정적파일 미들웨어 (public폴더)
app.use('/sfu', express.static(path.join(_dirname, 'public')))

//CORS 설정
const cors = require('cors');
app.use(
    cors({
        origin: [
            'https://simsimhae.store',
            'https://localhost:3000',
            'https://front-black-delta.vercel.app',
            'https://testmedia.vercel.app',
        ],
        credentials: true,
    })
);

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
  cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
}

const httpsServer = https.createServer(options, app)
httpsServer.listen(3000, () => {
  console.log('listening on port: ' + 3000)
})

const io = new Server(httpsServer, {
  cors: {
    origin: [
        'https://simsimhae.store',
        'https://localhost:3000',
        'https://front-black-delta.vercel.app',
        'https://testmedia.vercel.app',
    ],
    credentials: true,
},
ipv6: false,
});

// socket.io namespace (could represent a room?)
const peers = io.of('/mediasoup')

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer 
 **/
let worker
let Router
let producerTransport
let consumerTransport
let producer
let consumer

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  })
  console.log(`worker pid ${worker.pid}`)

  worker.on('died', error => {
    // This implies something serious happened, so kill the application
    console.error('mediasoup worker has died')
    setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
  })

  return worker
}

// We create a Worker as soon as our application starts
worker = createWorker()

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
]
//소켓 연결
peers.on('connection', async socket => {
  console.log(socket.id)
  socket.emit('connection-success', {
    //소켓 아이디 출력
    socketId: socket.id
  })

  socket.on('disconnect', () => {
    //peer 연결 해제
    console.log('peer disconnected')
  })

  // worker.createRouter(options)
  // options = { mediaCodecs, appData }
  // mediaCodecs -> defined above
  // appData -> custom application data - we are not supplying any
  // none of the two are required
  Router = await worker.createRouter({ mediaCodecs, })

  // Client emits a request for RTP Capabilities
  // This event responds to the request
  //(2)
  socket.on('getRtpCapabilities', (callback) => {

    const rtpCapabilities = Router.rtpCapabilities

    //rtp capabilities 출력
    console.log('rtp Capabilities = ', rtpCapabilities)

    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities })
  })

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  //(4) // (6) - producer
  //여기서 dtlsParameters 혹은 id 값을 못받는듯
  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    console.log(`Is this a sender request? ${sender}`)
    // The client indicates if it is a producer or a consumer
    // if sender is true, indicates a producer else a consumer
    if (sender)
      producerTransport = await createWebRtcTransport(callback)
    else
      consumerTransport = await createWebRtcTransport(callback)
  })

  // see client's socket.emit('transport-connect', ...)
  //(4)-1   producerTransport.on('connect'
  socket.on('transport-connect', async ({ dtlsParameters }) => {
    console.log('(4)-1실행됨. dtlsParameters 밑에나옴')
    console.log('DTLS PARAMS... ', { dtlsParameters })//
    await producerTransport.connect({ dtlsParameters })
  })

  // see client's socket.emit('transport-produce', ...)
  //(4)-2   producerTransport.on('produce'
  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
    // call produce based on the prameters from the client
    console.log('(4)-2 실행됨 / Producer ID 밑에 나옴')
    producer = await producerTransport.produce({
      kind,
      rtpParameters,
    })

    console.log('Producer ID: ', producer.id, producer.kind)

    //(5) ??? connectSendTransport 근데 양쪽다 on인데유?
    producer.on('transportclose', () => {
      console.log('transport for this producer closed ')
      producer.close()
    })

    // Send back to the client the Producer's id
    callback({
      id: producer.id
    })
  })

  // see client's socket.emit('transport-recv-connect', ...)
  //(6)에 추가로 작동
  //인척하는 (7)임
  socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
    console.log('(6)추가부분 실행됨. 아래 DTLS PARAMS 출력됨')
    console.log(`DTLS PARAMS: ${dtlsParameters}`)
    await consumerTransport.connect({ dtlsParameters })
  })

  //(7)
  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    try {
      // check if the router can consume the specified producer
      console.log('rtcCapabilities를 잘 받아오나요? = ', rtpCapabilities);
      console.log('if문 조건식이 참인가요? = ',);
      if (Router.canConsume({
        producerId: producer.id,
        rtpCapabilities
      })) {
        // transport can now consume and return a consumer
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        })

        consumer.on('transportclose', () => {
          console.log('transport close from consumer')
        })

        consumer.on('producerclose', () => {
          console.log('producer of consumer closed')
        })

        // from the consumer extract the following params
        // to send back to the Client
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        }

        // send the parameters to the client
        callback({ params })
      }
    } catch (error) {
      console.log(error.message)
      callback({
        params: {
          error: error
        }
      })
    }
  })

  //프론트 (7) 마지막 emit
  socket.on('consumer-resume', async () => {
    console.log('consumer resume');
    await consumer.resume()
  })
})

let listenip;
let announceip;
if (process.platform === "linux") {
  listenip = "172.31.40.255";
  announceip = "3.39.21.142";
} else {
  listenip = "127.0.0.1";
  announceip = null;
}
console.log("🎧 listenip is : ", listenip);

  //(4), (6)
const createWebRtcTransport = async (callback) => {
  try {
    // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
    const webRtcTransport_options = {
      listenIps: [
        {
          ip: listenip,
          announceIp: announceip
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    }

    // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
    let transport = await Router.createWebRtcTransport(webRtcTransport_options)
    console.log(`transport id: ${transport.id}`)

    transport.on('dtlsstatechange', dtlsState => {
      if (dtlsState === 'closed') {
        transport.close()
      }
    })

    transport.on('close', () => {
      console.log('transport closed')
    })

    // send back to the client the following prameters
    callback({
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    })

    return transport

  } catch (error) {
    console.log(error)
    callback({
      params: {
        error: error
      }
    })
  }
}
