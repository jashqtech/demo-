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
const fetch = require("cross-fetch");
const translate = require('google-translate-api-x');
const { createClient,LiveTranscriptionEvents } = require("@deepgram/sdk");
const { Vonage } = require('@vonage/server-sdk');
// - or -
// import { createClient } from "@deepgram/sdk";
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
console.log(deepgram.version)

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

// helper function to stream audio chunks to websocket, skipping WAV header
const playback_to_websocket = async (ws, stream) => {  
  if (stream) {
    const reader = stream.getReader();
    let headerSkipped = false;
    let bytesSkipped = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let audioData = value;

      if (!headerSkipped) {
        if (bytesSkipped + value.length >= 44) {
          const skipInThis = 44 - bytesSkipped;
          audioData = value.subarray(skipInThis);
          headerSkipped = true;
        } else {
          bytesSkipped += value.length;
          continue;
        }
      }

      // Send in 640-byte chunks
      for (let i = 0; i < audioData.length; i += 640) {
        ws.send(audioData.subarray(i, i + 640));
      }
    }
  } else {
    console.error("Error generating audio stream");
  }
};



wsServer.on('connection', websocket => {
	//assign an id to this client
	websocket.id = wsServer.getUniqueID();
	// Create a websocket connection to Deepgram
	// In this example, punctuation is turned on, interim results are turned off, and language is set to UK English.
	var dgConnection = deepgram.listen.live();
	//var dgConnection = null;

	
	websocket.on('message', function message(data, isBinary) {

		if (data.toString().includes("content-type")){
			//console.log(data)
			//change the ID to the current sessionID
			websocket.id =JSON.parse(data)['sessionid'];
			//Multilingual (English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian, and Dutch): multi

			dgConnection = deepgram.listen.live({
				punctuate: true,
				interim_results: false,
				language: "multi",
				model: "nova-3",
				encoding: "linear16",
				sample_rate: 16000,
				channel: 2,
				diarize: true
			});

			dgConnection.on(LiveTranscriptionEvents.Open, () => {
				console.log("DEEPGRAM CONN OPEN")
				dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
					// Write only the transcript to the console
					try {
						transcript=data.channel.alternatives[0].transcript, { depth: null };
						if(transcript!='' && transcript != ' ' && data.is_final){
							words = data.channel.alternatives[0].words
							message_to_send = {}
							
							words.forEach(function each(word) {
								if(word.speaker in message_to_send){
									message_to_send[word.speaker]+=" "+word.punctuated_word
								}else{
									message_to_send[word.speaker]=word.punctuated_word
								}
								
							});

							// Parallelize translations
							const translatePromises = Object.entries(message_to_send).map(async ([key, value]) => {
								const res = await translate(value, { to: 'en' });
								const translated = res.text;
								const originalLang = res.from.language.iso;
								message_to_send[key] = translated;
								console.log("Original text language", originalLang); 
								console.log("Translated text", translated);
								return { key, translated, originalLang };
							});

							const processed = await Promise.all(translatePromises);

							console.log("Message: ",message_to_send)
							to_send = {
								"sessionid":websocket.id,
								"messages":message_to_send
							}
							wsServer.clients.forEach(function each(client) {
								if(client.id === "client_"+websocket.id){
									client.send(JSON.stringify(to_send))
								}
							});

							// Sequentially handle TTS for non-English originals
							for (const item of processed) {
								if (!item.originalLang.includes("en")) {
									// Make a request and configure the request with options (such as model choice, audio configuration, etc.)
									const response = await deepgram.speak.request(
										{ text: item.translated },
										{
											model: "aura-2-thalia-en",
											encoding: "linear16",
											container: "wav",
											sample_rate: 16000,
										}
									);
									// Get the audio stream and headers from the response
									const stream = await response.getStream();
									await playback_to_websocket(websocket, stream);
								}
							}
						}
						
					} catch (error) {
						console.log("no data", error);
					}
				});
				dgConnection.on(LiveTranscriptionEvents.Close, (close) => {
					console.log("Connection closed.", close);
					dgConnection.requestClose();
				});
				dgConnection.on(LiveTranscriptionEvents.Error, (error) => {
					console.log("Error.", error);
					dgConnection.requestClose();
				});
			});
		
			console.log("session_id is: ", websocket.id)
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
					//will also close deepgram connection
					client.close();
				}
			});
		}
		else{
			//console.log(data)
			if(dgConnection != null){
				if (dgConnection.getReadyState() == 1) {
					dgConnection.send(data);
				}
			}
			
		}
		
		// Continue as before.
	  });
	  
	websocket.on('close', function close(code, data) {
		const reason = data.toString();
		
		if(dgConnection != null){dgConnection.requestClose();}
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
