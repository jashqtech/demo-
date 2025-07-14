# **Unified Video Subscriber Alternative Connection/Disconnection checker**

This Application is a workaround for a bug in MacOS where our browser SDK cannot detect connection or disconnection for participants with intermittent network. 

# **Deployment Guide**

## **1. Install dependencies:**

    npm install

## **2. Populate “.env”**
Copy `.env.samp` file as `.env` and put in the values for the following:
 
 

 - **APP_ID**
	- Your VONAGE App ID
- **PORT**
	- port where we run this service

## **3. Add your private key**
Open `private.key` and put your actual private key here

## **4. Running**

    node video-chat-server.js

## **5. How this works**
When deployed, point your web browser to the IP and Port where the server is running. You will see a simple UI with your Publisher view, a text box with the join link and a text box for token generation link. It also has buttons for disabling and enabling audio and video.

To let another user join you, just copy the join link and let that user use it.

## **6. Alternative Connection/Disconnection Detection**
Inside ``views/js/client.js``, starting at line 72, will be the alternative detection algorithm. You can add your logic in there for when the subscribers are detected to be disconnecting or reconnecting.

We are generally following this algorithm

    if(stream.publishingAudio == false && stream.publishingVideo==false){
	/* we can not make any decision because in this case we will not receive any packets */

	}
	else if(stream.publishAudio == true && stream.publishVideo == false){
		/* check if we are not receiving audio packets for x seconds and trigger disconnect. no need to check for video*/
	}
	else if(stream.publishAudio == false && stream.publishVideo == true){
		/* check if we are not receiving video packets for x seconds and trigger disconnect. no need to check for audio*/
	}
	else {
		/* trigger disconnect only if we are not receiving both audio and video for x seconds */
	}

Right now, the check interval is set to 5000 milliseconds, you can set it to a different rate at ``views/js/client.js`` line 3.
