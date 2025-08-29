# **Two way Audio connector Sample**

This demo uses bi directional Audio Connector to playback translations from English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian, and Dutch into English. It also displays diarize transcriptions. Uses Deepgram and Google Translate


# **Deployment Guide**

## **1. Install dependencies:**

    npm install

## **2. Populate “.env”**
Copy `.env.samp` file as `.env` and put in the values for the following:
 
 

 - **APP_ID**
	- Your VONAGE App ID
- **PORT**
	- port where we run this service
- **DEEPGRAM_API_KEY**
	- Your Deepgram API KEY
- **WEBSOCKET_SERVER_URI**
	- Your websocket server. In this sample, same as this servers URL, just use wss://
## **3. Add your private key**
Copy `private.key.samp` file as `private.key` and put your actual private key here

## **4. Running**

    node video-chat-server.js

## **5. How this works**
When deployed, point your web browser to the IP and Port where the server is running. You will see a simple UI with your Publisher view, a text box with the join link and a text box for token generation link. It also has buttons for disabling and enabling audio and video.

To let another user join you, just copy the join link and let that user use it.

## **6. Starting Deepgram**
Just press Start Deepgram and you will see your transcriptions
