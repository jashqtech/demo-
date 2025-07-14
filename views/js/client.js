//create a session
var apiKey = '';
var sessionId = '';
var token = '';
var session = '';
var stream_name = "video";


//connect to a session
window.startSession =(sessionId, token, apiKey) => {

	const queryString = window.location.search;
	console.log(queryString);
	const urlParams = new URLSearchParams(queryString);
	if(urlParams.has('stream_name')){
		stream_name = urlParams.get('stream_name')
	}

	var deferred = new $.Deferred();

	var publisher = OT.initPublisher("publisher", {
		insertMode: 'append',
		width: '100%',
		height: '100%',
		resolution: "640x480",
		name: stream_name
	});

	publisher.on('videoInputDeviceChanged', (device) => {
		console.log('video device', device);
		console.log(`changing video device: ${device.label}`);
		});

	publisher.on('audioInputDeviceChanged', (device) => {
		console.log('audio device', device);
		console.log(`changing audio device: ${device.label}`);
		});
	

	session = OT.initSession(apiKey, sessionId);
	session.connect(token, async function (err) {
		if (err) {
			console.log(err);
			deferred.resolve(false);
		} else {

			session.publish(publisher);
			
			deferred.resolve(true);
			//subscribe to other's stream
			session.on('streamCreated', function (event) {
				console.log("Stream UP")
				var subscriber = session.subscribe(event.stream, event.stream.name == "vonage_maxine"?"maxine":"subscriber", {
					insertMode: 'append',
					width: '100%',
					height: '100%',
					resolution: "640x480",
				});
				var subsid = subscriber.id
				
				if(event.stream.name == "vonage_maxine"){
					subscriber.subscribeToAudio(maxine_muted?false:true)
					maxine = subscriber;
				}
				if(String(event.stream.name).includes("mx_")){
					console.log("MX ENABLED")
					subscriber.subscribeToAudio(mx_users_muted?false:true)
					mx_enabled[subscriber.id]=subscriber
					console.log(mx_enabled)
				}
				subscriber.on("destroyed", function (event){
					console.log("SUBS DESTROYED: ", event)
					delete mx_enabled[subsid]
					try {
						if(maxine.id == null) {maxine = null}
					} catch (error) {
						//pass
					}

				})
				

				
				console.log("mx list: ",mx_enabled)
				console.log("maxine: ",maxine)

			});
			session.on('streamDestroyed', function (event) {
				
			});
			
		}
	});
	return deferred.promise();
}
try {
} catch (e) {
	console.log('No session yet');
}