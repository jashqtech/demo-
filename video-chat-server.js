require('dotenv').config();
var express = require('express');
var cors = require('cors');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var app = express();
var crypto = require('crypto');
const { Auth } = require('@vonage/auth');
const { Video } = require('@vonage/video');
const ws = require('ws');
const fs = require('fs');
app.set('view engine', 'ejs'); 
app.use(logger('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use('/', express.static(path.join(__dirname, 'views')));
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const packageDef = protoLoader.loadSync("stenomatic.proto", {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const grpcObject = grpc.loadPackageDefinition(packageDef);
const stenomaticClient = new grpcObject.stenomatic.Stenomatic(
  "api.stenomatic.com:443",
  grpc.credentials.createSsl()
);

const appId = process.env.APP_ID;
const port = process.env.PORT;
const websocket_server_uri = process.env.WEBSOCKET_SERVER_URI
const credentials = new Auth({
	applicationId: appId,
	privateKey:  fs.readFileSync(path.join(__dirname, "private.key")),
});

const options = {};
const videoClient = new Video(credentials, options);
var sessionId = null;


async function new_session(res, req) {
	const session = await videoClient.createSession({ mediaMode: 'routed' })
	console.log(session)
	sessionId = session.sessionId;
	console.log(sessionId)
	token = videoClient.generateClientToken(sessionId)
	res.render('index.ejs', {
		sessionId: sessionId,
		token: token,
		appId: appId,
		websocket_server_uri: websocket_server_uri,
	});
}


app.get('/', function (req, res) {
	new_session(res, req);
});

app.get('/:sessionId', function (req, res) {
	token = videoClient.generateClientToken(sessionId);
	res.render('index.ejs', {
		sessionId: sessionId,
		token: token,
		appId: appId,
		websocket_server_uri: websocket_server_uri,
	});
});

app.get('/:sessionId/join', function (req, res) {
	console.log(req.params);
	sessionId = req.params['sessionId'];
	token = videoClient.generateClientToken(sessionId);
	res.render('index.ejs', {
		sessionId: sessionId,
		token: token,
		appId: appId,
		websocket_server_uri: websocket_server_uri,
	});
});

app.get('/:sessionId/token', function (req, res) {
	sessionId = req.params['sessionId'];
	role = req.query['role'] || 'publisher';	
	token = videoClient.generateClientToken(sessionId,{role:role});
	params = `${appId} ${sessionId} ${token} true`
	return res.json({session_id:sessionId, token:token, appId:appId, role:role, commandParams: params})
});

//View all Connected Streams
//https://developer.vonage.com/en/api/video#get-stream-layouts
app.get('/:sessionId/streams', async function (req, res) {
	sessionId = req.params['sessionId'];
	streamInfo = await videoClient.getStreamInfo(sessionId)
	return res.json({session_id:sessionId, streamInfo:streamInfo})
});


//Start an Audio Connector Session
app.get('/:sessionId/audioconnect', async function (req, res) {
	console.log("Audio connect")
  const sessionId = req.params.sessionId;   
    const token = videoClient.generateClientToken(sessionId);
		console.log('seession id ',sessionId)
	result = await videoClient.connectToWebsocket(sessionId, token, {"uri":websocket_server_uri, "headers": {"sessionid": req.params['sessionId']}, "audioRate":16000, "bidirectional":true})
	console.log("AC::", result)
	if (result.connectionId!=null) {
		console.log('Audio Socket websocket connected');
		return res.json({success:true,message:"Audio Connecter connected to socket"}, 200);
		
	} else {
		console.log('Error:', error.message);
		return res.json({success:false,message:"Audio Connector failed to connect to socket"}, 401);
	}
});

// Set up a headless websocket server for our Audio Connector
const wsServer = new ws.Server({ noServer: true });
console.log("start ws")
wsServer.getUniqueID = function () {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }		
    return s4() + s4() + '-' + s4();
};

wsServer.on('connection', websocket => {
	//assign an id to this client
	websocket.id = wsServer.getUniqueID();
	// Create a websocket connection to Stenomatic
	let grpcCall = null;
	let lastRecognition = "";
	let lastTranslated = "";
	
	websocket.on('message', function message(data, isBinary) {

		if (data.toString().includes("content-type")){
			//console.log(data)
			//change the ID to the current sessionID
			websocket.id =JSON.parse(data)['sessionid'];
			console.log("session_id is: ", websocket.id)
			
			const metadata = new grpc.Metadata();
			metadata.add("x-mint-api-key", process.env.STENOMATIC_API_KEY);

			grpcCall = stenomaticClient.VoiceTranslate(metadata);
			
			const configPayload = {
				config: {
				  // audio_language_code: "hi-IN",
				  audio_language_code: "es-ES",
				  target_languages_codes: ["en-US"],
				  audio_encoding: "LINEAR_16_PCM",
				  voice: {
					gender: "FEMALE",
					audio_encoding: "RIFF_LINEAR_16",
					audio_sample_rate: 16000,
				  },
				  phrases: [],
				  interim_results: true,
				  single_utterance: false,
				  max_alternatives: 1,
				},
			};
			
			console.log("Sending config to Stenomatic");
			grpcCall.write(configPayload);

			grpcCall.on("data", (resp) => {
				try {
				  if (resp.recognition) {
					lastRecognition = resp.recognition.text || "";
					console.log(`Recognition: ${lastRecognition}`);
					// Optionally send original recognition if needed
				  }
				  
				  if (resp.translations && resp.translations.length > 0) {
					const translation = resp.translations.find(t => t.language_code === "en-US");
					if (translation) {
					  lastTranslated = translation.text;
					  const message_to_send = { "0": lastTranslated };
					  const to_send = {
						"sessionid": websocket.id,
						"messages": message_to_send,
						"is_interim": false
					  };
					  wsServer.clients.forEach(function each(client) {
						if (client.id === "client_" + websocket.id) {
						  client.send(JSON.stringify(to_send));
						}
					  });
					  console.log(`Final translation sent: ${lastTranslated}`);
					}
				  }
				  
				  if (resp.partial_translation) {
					let partial_text;
					if (typeof resp.partial_translation === 'string') {
					  partial_text = resp.partial_translation;
					} else if (resp.partial_translation.text) {
					  partial_text = resp.partial_translation.text;
					} else {
					  return;
					}
					const message_to_send = { "0": partial_text };
					const to_send = {
					  "sessionid": websocket.id,
					  "messages": message_to_send,
					  "is_interim": true
					};
					wsServer.clients.forEach(function each(client) {
					  if (client.id === "client_" + websocket.id) {
						client.send(JSON.stringify(to_send));
					  }
					});
					console.log(`Interim translation sent: ${partial_text}`);
				  }
				  
				  if (resp.tts && resp.tts.length > 0) {
					if (lastRecognition === lastTranslated) {
					  console.log("Skipping TTS as source appears to be English");
					  return;
					}
					resp.tts.forEach((tts) => {
					  let audioData = Buffer.from(tts.audio);
					  if (audioData.length > 44) {
						audioData = audioData.subarray(44); // Skip WAV header
					  }
					  for (let i = 0; i < audioData.length; i += 640) {
						const chunk = audioData.subarray(i, i + 640);
						websocket.send(chunk);
					  }
					  console.log(`TTS audio sent: size ${tts.audio.length}`);
					});
				  }
				} catch (error) {
				  console.error("Error processing Stenomatic response:", error);
				}
			  });

			  grpcCall.on("error", (err) => {
				console.error("Stenomatic gRPC error:", err.message);
			  });

			  grpcCall.on("end", () => {
				console.log("Stenomatic gRPC stream ended");
			  });
		}
		else if (data.toString().includes("set_id")){
			id = JSON.parse(data)['id']
			//change the ID to the current sessionID
			websocket.id = id;
			console.log("client_id is: ", id)
		}
		else if (data.toString().includes("close_audio_connector")){
			console.log("Closing", data)
			var session_id = JSON.parse(data)['sessionid']
			
			wsServer.clients.forEach(function each(client) {
				if(client.id === session_id){
					//will also close grpc connection
					client.close();
				}
			});
		}
		else{
			//console.log(data)
			if(grpcCall){
				grpcCall.write({ audio_content: data });
			}
			
		}
		
		// Continue as before.
	  });
	  
	websocket.on('close', function close(code, data) {
		const reason = data.toString();
		
		if(grpcCall != null){grpcCall.end();}
		// Continue as before.
	  });
	  
});
//new code 
const server = app.listen(port);
server.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, socket => {
    wsServer.emit('connection', socket, request);
  });
});