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

// helper function to convert stream to audio buffer
const getAudioBuffer = async (response) => {
  const reader = response.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const dataArray = chunks.reduce(
    (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
    new Uint8Array(0)
  );
  return Buffer.from(dataArray.buffer);
};

const playback_to_websocket = async (ws, stream) => {  
  if (stream) {
    // Convert the stream to an audio buffer
    var buffer = await getAudioBuffer(stream);
		//remove the WAV header (first 44 bytes)
		buffer = buffer.subarray(44,buffer.length)
		console.log("Buffer", buffer)
    //Write the audio buffer to a filwebsocket
		for(i=0; i<= buffer.length; i+=640){
			ws.send(buffer.subarray(i,i+640))
		}
  } else {
    console.error("Error generating audio:", stream);
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

		// Improved Deepgram configuration for better long sentence recognition
dgConnection = deepgram.listen.live({
    punctuate: true,
    interim_results: true, // Enable interim results to get partial transcriptions
    language: "multi",
    model: "nova-3", // Using nova-3 with optimized settings for long sentences
    encoding: "linear16",
    sample_rate: 16000,
    channels: 2, // Note: use 'channels' instead of 'channel' for nova-3
    diarize: true,
    // Nova-3 optimized parameters for long sentence handling
    endpointing: 500, // Increased for nova-3 - wait 500ms before considering speech ended
    utterance_end_ms: 1500, // Increased for nova-3 - wait 1.5s before finalizing
    vad_turnoff: 1500, // Voice activity detection timeout for longer pauses
    filler_words: true, // Handle filler words better
    numerals: true, // Better number recognition
    profanity_filter: false, // Disable if causing issues with transcription
    redact: false, // Disable redaction for better accuracy
    smart_format: true // Enable smart formatting for nova-3
});

// Modified transcript handling with better logic for long sentences
dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    try {
        const transcript = data.channel.alternatives[0].transcript;
        
        // Handle both interim and final results
        if (transcript && transcript.trim() !== '') {
            console.log(`${data.is_final ? 'FINAL' : 'INTERIM'}: ${transcript}`);
            
            // Only process final results for translation and playback
            if (data.is_final) {
                const words = data.channel.alternatives[0].words;
                let message_to_send = {};
                
                // Group words by speaker
                words.forEach(function(word) {
                    const speaker = word.speaker || 0; // Default to speaker 0 if undefined
                    if (speaker in message_to_send) {
                        message_to_send[speaker] += " " + word.punctuated_word;
                    } else {
                        message_to_send[speaker] = word.punctuated_word;
                    }
                });
                
                // Process each speaker's complete message
                for (const [speaker, text] of Object.entries(message_to_send)) {
                    console.log(`Speaker ${speaker}: ${text}`);
                    
                    try {
                        const res = await translate(text, { to: 'en' });
                        message_to_send[speaker] = res.text;
                        console.log("Original text language:", res.from.language.iso);
                        console.log("Translated text:", res.text);
                        
                        // Only generate speech if not originally in English
                        if (!res.from.language.iso.includes("en")) {
                            const response = await deepgram.speak.request(
                                { text: res.text },
                                {
                                    model: "aura-2-thalia-en",
                                    encoding: "linear16",
                                    container: "wav",
                                    sample_rate: 16000,
                                }
                            );
                            
                            const stream = await response.getStream();
                            await playback_to_websocket(websocket, stream);
                        }
                    } catch (translationError) {
                        console.error("Translation error:", translationError);
                        // Keep original text if translation fails
                    }
                }
                
                console.log("Complete message:", message_to_send);
                
                // Send to clients
                const to_send = {
                    "sessionid": websocket.id,
                    "messages": message_to_send
                };
                
                wsServer.clients.forEach(function(client) {
                    if (client.id === "client_" + websocket.id) {
                        client.send(JSON.stringify(to_send));
                    }
                });
            }
        }
    } catch (error) {
        console.error("Transcript processing error:", error);
    }
});

// Improved audio buffer playback with better chunking
const playback_to_websocket = async (ws, stream) => {
    try {
        if (stream) {
            const buffer = await getAudioBuffer(stream);
            // Remove the WAV header (first 44 bytes)
            const audioData = buffer.subarray(44);
            console.log("Audio buffer size:", audioData.length);
            
            // Send in smaller, more frequent chunks for better real-time performance
            const chunkSize = 320; // Smaller chunks for better streaming
            for (let i = 0; i < audioData.length; i += chunkSize) {
                const chunk = audioData.subarray(i, Math.min(i + chunkSize, audioData.length));
                if (ws.readyState === ws.OPEN) {
                    ws.send(chunk);
                    // Small delay between chunks to prevent overwhelming the connection
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }
    } catch (error) {
        console.error("Audio playback error:", error);
    }
};

// Add connection health monitoring
dgConnection.on(LiveTranscriptionEvents.Open, () => {
    console.log("DEEPGRAM CONNECTION OPENED");
});

dgConnection.on(LiveTranscriptionEvents.Close, (close) => {
    console.log("Deepgram connection closed:", close);
});

dgConnection.on(LiveTranscriptionEvents.Error, (error) => {
    console.error("Deepgram connection error:", error);
});

// Add periodic connection health check
setInterval(() => {
    if (dgConnection && dgConnection.getReadyState() !== 1) {
        console.log("Deepgram connection state:", dgConnection.getReadyState());
    }
}, 30000); // Check every 30 seconds

		
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

const server = app.listen(port);
server.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, socket => {
    wsServer.emit('connection', socket, request);
  });
});
