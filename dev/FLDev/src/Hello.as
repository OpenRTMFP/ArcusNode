package  
{
	
	import com.bit101.components.CheckBox;
	import com.bit101.components.InputText;
	import com.bit101.components.Label;
	import com.bit101.components.List;
	import com.bit101.components.PushButton;
	import com.bit101.components.RadioButton;
	import com.bit101.components.Text;
	import com.bit101.components.TextArea;
	import flash.display.Bitmap;
	import flash.display.BitmapData;
	import flash.display.Loader;
	import flash.display.MovieClip;
	import flash.events.ActivityEvent;
	import flash.events.Event;
	import flash.events.IOErrorEvent;
	import flash.events.MouseEvent;
	import flash.events.NetStatusEvent;
	import flash.events.SecurityErrorEvent;
	import flash.media.Camera;
	import flash.media.Microphone;
	import flash.media.Video;
	import flash.net.FileReference;
	import flash.net.GroupSpecifier;
	import flash.net.NetConnection;
	import flash.net.NetGroup;
	import flash.net.NetGroupReplicationStrategy;
	import flash.net.NetStream;
	import flash.utils.ByteArray;
	import flash.utils.setTimeout;
	import flash.display.Sprite;
  import flash.display.StageAlign;
  import flash.display.StageScaleMode;
  
	public class Hello extends Sprite
	{
		private var _connected:Boolean = false
		private var _broadcasting:Boolean = false
		private var _subsribed:Boolean = false
		private var _webcam:Boolean = false;
		
		// gui movieclips
		
		private var ntstr_mc:MovieClip 
		private var grpspf_mc:MovieClip
		private var ntcon_mc:MovieClip 
		private var psting_mc:MovieClip 
		
		// GroupSpecifier GUI
		
		private var label_GroupSpecifier:Label 
		private var it_groupSpecieferName:InputText 
		private var label_name:Label 
		private var cb_ipMulticastMemberUpdatesEnabled:CheckBox 
		private var label_ipMulticastMemberUpdatesEnabled:Label 
		private var cb_multicastEnabled:CheckBox
		private var label_multicastEnabled:Label 
		private var cb_objectReplicationEnabled:CheckBox 
		private var label_objectReplicationEnabled:Label 
		private var cb_peerToPeerDisabled:CheckBox 
		private var label_peerToPeerDisabled:Label 
		private var cb_postingEnabled:CheckBox 
		private var label_postingEnabled:Label 
		private var cb_routingEnabled:CheckBox 
		private var label_routingEnabled:Label 
		private var cb_serverChannelEnabled:CheckBox 
		private var label_serverChannelEnabled:Label 
		
		// Netstream GUI
		
		private var it_streamName:InputText
		private var label_streamName:Label
		private var btn_broadcast:PushButton 
		private var btn_subscribe:PushButton
		private var label_Netstream:Label 
		private var btn_webcam:PushButton;
		private var btn_netstream:PushButton 
		
		// NetConnection GUI
		private var label_NetConnection:Label 
		private var label_protocol_server:Label
		private var it_protocol_server:InputText 
		private var label_ip_server:Label 
		private var it_ip_server:InputText 
		private var label_devkey_server:Label 
		private var it_devkey_server:InputText 
		private var btn_connect:PushButton 
		private var btn_disconnect:PushButton 
		private var cb_reconnect:CheckBox 
		
		// info GUI
		private var info_mc:MovieClip 
		private var ta_info:TextArea 
		private var t_myID:Text
		private var l_otherID:List 
		
		//video GUI
		private var video_mc:Sprite;
		private var videoScreen_local:MovieClip;
		private var videoScreen_other:MovieClip;
		
		// post GUI
		private var label_Posting:Label 
		private var label_postingName:Label 
		private var it_postingName:InputText 
		private var label_postingMessage:Label 
		private var it_postingMessage:InputText 
		private var btn_post:PushButton 
		private var btn_sendToNeighbor:PushButton

		//filesharing GUI
		public var flsr_mc:MovieClip
		
		private var file:FileReference;
		private var p2pSharedObject:Object
		
		// 
		private var nc:NetConnection;
		private var groupspec:GroupSpecifier
		private var stream:NetStream;
		private var group:NetGroup;
		
		//
		private var otherIDs:Array = []

		private var userName:String;
		
		private var bmpd_ruis_local:BitmapData;
		private var bmpd_ruis_other:BitmapData;
		
		private var bmp_ruis_local:Bitmap;
		private var bmp_ruis_other:Bitmap;
		private var perlinNoise_number:Number = 0;
		
		private var camera:Camera;
		private var microphone:Microphone;
		
		private var video:Video = new Video()
		
		
		
		
		
		public function Hello() 
		{
			if (stage) init(null);
      else addEventListener(Event.ADDED_TO_STAGE, init);
		}
		
		private function init(e:Event):void 
		{
			removeEventListener(Event.ADDED_TO_STAGE, init);
      stage.scaleMode = StageScaleMode.NO_SCALE;
      stage.align = StageAlign.TOP_LEFT;
      gui()
			
			info = 'Started...'
			
			userName = 'user_' + int(Math.random()*1000)
			it_postingName.text = userName
			
			
			p2pSharedObject = new Object()
			
			
			p2pSharedObject.size = 0
			p2pSharedObject.packetLenght = 0
			p2pSharedObject.data = 0
			p2pSharedObject.name = ''
			
			
			p2pSharedObject.chunks = new Object();
			
			
			var btn_extra:PushButton = new PushButton(stage, video_mc.x , video_mc.y + video_mc.height, 'ping close neighbor', OnPing) 
			
			stage.addEventListener(Event.ENTER_FRAME, onENTER_FRAME)
			
		}
		
		private function OnPing(e:Event):void
		{
		
			var message:Object = new Object();
			message.sender = group.convertPeerIDToGroupAddress(nc.nearID);
			
			message.user =  'nc.nearID'
			message.text = 'ping'+Math.random()*100000;
		 
		 
			var a:* = group.sendToNearest(message, group.convertPeerIDToGroupAddress(otherIDs[0]))
			trace(a)
			//group.post(message);
		}
		//_________________________________________________________________________________________________GUI
		private function gui():void
		{
			gui_GroupSpecifier()
			gui_NetStream()
			gui_NetConnection()
			gui_Info()
			gui_Video()
			gui_Posting()
			gui_filesharing()
			
		
			
			grpspf_mc.y = ntcon_mc.y + ntcon_mc.height
			ntstr_mc.y = grpspf_mc.y + grpspf_mc.height + 20
			info_mc.x = 600
			video_mc.x = info_mc.x
			video_mc.y = info_mc.y + info_mc.height + 80
			psting_mc.y = ntstr_mc.y + 100
			flsr_mc.y = psting_mc.y + 150
			
		}
		
		private function onENTER_FRAME(e:Event):void 
		{
			//ruis()
		}

		private function gui_Video():void
		{
			video_mc = new Sprite();
			stage.addChild(video_mc)
			
			videoScreen_local = new MovieClip()
			video_mc.addChild(videoScreen_local)
			videoScreen_local.graphics.beginFill(0xc9c9c9)
			videoScreen_local.graphics.lineStyle(1, 0x00)
			videoScreen_local.graphics.drawRect(0, 0, 320, 240)
			videoScreen_local.y = 20
			
			videoScreen_other = new MovieClip()
			video_mc.addChild(videoScreen_other)
			videoScreen_other.graphics.beginFill(0xc9c9c9)
			videoScreen_other.graphics.lineStyle(1, 0x00)
			videoScreen_other.graphics.drawRect(0,0,320,240)
			videoScreen_other.x = videoScreen_local.x + videoScreen_local.width + 20
			videoScreen_other.y = 20
			
			var l_videoScreen_local:Label = new Label(video_mc, 0, 0, 'local webcam')
			var l_videoScreen_other:Label = new Label(video_mc, videoScreen_local.x + videoScreen_local.width + 20, 0, 'otherside video')
			
			
			bmpd_ruis_local = new BitmapData(320, 240, false)
			bmpd_ruis_other = new BitmapData(320, 240, false)
			
			bmp_ruis_local = new Bitmap(bmpd_ruis_local)
			bmp_ruis_other = new Bitmap(bmpd_ruis_other)
			
			videoScreen_local.addChild(bmp_ruis_local)
			videoScreen_other.addChild(bmp_ruis_other)
			
			ruis();
			
		}
		private function gui_Info():void
		{
			
			info_mc = new MovieClip()
			stage.addChild(info_mc)
			
			ta_info = new TextArea(info_mc, 0, 0, 'info')
			ta_info.height = 300
			ta_info.width = ta_info.width + 200
			
			var l_myID:Label = new Label(info_mc, 0, ta_info.x + ta_info.height + 20, 'my ID')
			t_myID = new Text(info_mc, 50, ta_info.x + ta_info.height + 20, 'my id')
			t_myID.height = 20
			t_myID.width = t_myID.width + 150
			
			var l_other:Label = new Label(info_mc, 0, t_myID.y + 20, 'other ID\'s')
			l_otherID = new List(info_mc, 50, t_myID.y + 20)
			l_otherID.width = t_myID.width 
		}
		
		private function gui_Posting():void
		{
			
			psting_mc= new MovieClip()
			stage.addChild(psting_mc)
			
			
			label_Posting = new Label(psting_mc, 0, 0, 'post to peers')
			
			label_postingName = new Label(psting_mc, 0, 20, 'name')
			
			it_postingName = new InputText(psting_mc, 30,20, '', update)
			
			label_postingMessage = new Label(psting_mc, 0, 40, 'msg')
			
			it_postingMessage = new InputText(psting_mc,30,40, '', update)
			it_postingMessage.width = 250
			var label_postingMessage2:Label = new Label(psting_mc, 320, 40, 'should be diff than last one')
			
			btn_post = new PushButton(psting_mc, 30, 60, 'post to all', onPost)
			var label_postingMessage3:Label = new Label(psting_mc, 320, 60, 'posting should be enabled')
			btn_sendToNeighbor = new PushButton(psting_mc, 30, 90, 'sendToNeighbor', onPost)
			var label_postingMessage4:Label = new Label(psting_mc, 320, 90, 'routing should be enabled')
			
			//var btn_post:PushButton = new PushButton(psting_mc, 30, 60, 'post to all', onPost)
			
			
			
			
			
		}
		
		
		
		private function gui_filesharing():void
		{
				 
				flsr_mc = new MovieClip()
				stage.addChild(flsr_mc)
				
				var label_filesharing:Label = new Label(flsr_mc, 0,0, 'filesharing')
				var btn_browse:PushButton = new PushButton(flsr_mc, 0, 30, 'browse', onBrowse)
				var btn_getfile:PushButton = new PushButton(flsr_mc, 0, 130, 'get', onGet)
		}
		
		private function onGet(e:Event):void
		{
			group.addWantObjects(0, 1);
		}
		
		private function onBrowse(e:Event):void
		{
			file = new FileReference();
			file.addEventListener(Event.SELECT, selectHandler);
			//file.addEventListener(IOErrorEvent.IO_ERROR, ioErrorHandler);
			//file.addEventListener(ProgressEvent.PROGRESS, progressHandler);
			//file.addEventListener(SecurityErrorEvent.SECURITY_ERROR, securityErrorHandler)
			file.addEventListener(Event.COMPLETE, onBrowseCOMPLETE);
			file.browse();
			
		}
		private function selectHandler(event:Event):void 
		{
			file.load();
			
		}
		
		
		private function onBrowseCOMPLETE(e:Event):void 
		{
			
			info = ("completeHandler");
			p2pSharedObject = new Object()
			
			
			p2pSharedObject.size = file.size;
			p2pSharedObject.packetLenght = Math.floor(file.size/64000)+1;
			p2pSharedObject.data = file.data;
			p2pSharedObject.name = file.name
			
			//in een array ?
			
			p2pSharedObject.chunks = new Object();
			p2pSharedObject.chunks[0] = p2pSharedObject.packetLenght+1;
			for(var i:int = 1;i<p2pSharedObject.packetLenght;i++){
				p2pSharedObject.chunks[i] = new ByteArray();
				p2pSharedObject.data.readBytes(p2pSharedObject.chunks[i],0,64000);
				
			}
			// +1 last packet
			p2pSharedObject.chunks[p2pSharedObject.packetLenght] = new ByteArray();
			p2pSharedObject.data.readBytes(p2pSharedObject.chunks[i],0,p2pSharedObject.data.bytesAvailable);
			
			p2pSharedObject.packetLenght+=1;
			
			info = ("----- p2pSharedObject -----");
			info = ("packetLenght: "+(p2pSharedObject.packetLenght));
			
			
			group.replicationStrategy = NetGroupReplicationStrategy.LOWEST_FIRST;
			group.addHaveObjects(0, p2pSharedObject.packetLenght);
			
			var message:Object = new Object();
			message.user = 'share'
			message.text = file.name + '' + t_myID.text
			
			group.post(message)
		
		}
		
		
		private function gui_NetConnection():void
		{
			
			ntcon_mc = new MovieClip()
			stage.addChild(ntcon_mc)
			
			label_NetConnection = new Label(ntcon_mc, 0, 0, "NetConnection")
			label_protocol_server = new Label(ntcon_mc, 0,20, 'Protocol')
			it_protocol_server = new InputText(ntcon_mc, label_protocol_server.x + label_protocol_server.width + 20,20, 'rtmfp', update)
			label_ip_server = new Label(ntcon_mc, 0,40, 'IP')
			it_ip_server = new InputText(ntcon_mc, it_protocol_server.x,40, 'p2p.rtmfp.net', update)
			
			label_devkey_server = new Label(ntcon_mc, 0, 60, 'dev key')
			it_devkey_server = new InputText(ntcon_mc, it_protocol_server.x , 60, '', update)
			
			btn_connect = new PushButton(ntcon_mc, 0, 90, 'connect', onConnect)
			btn_disconnect = new PushButton(ntcon_mc, btn_connect.x+btn_connect.width + 10, 90, 'disconnect', ondisConnect)
			cb_reconnect = new CheckBox(ntcon_mc, 0, 120, 'reconnect (after 1 min) when connection failed', update)
		}
		private function gui_NetStream():void
		{
			ntstr_mc = new MovieClip()
			stage.addChild(ntstr_mc)
			
			
			
			
			label_Netstream = new Label(ntstr_mc, 0,0,"NetStream")
			
			
			it_streamName = new InputText(ntstr_mc, 0, 20, "STREAM_NAME_XYZ", update)
			label_streamName = new Label(ntstr_mc, it_streamName.x + it_streamName.width, 20, "Name A string that identifies the stream. Clients that subscribe to this stream must pass this same name")
			
			
			
			btn_netstream = new PushButton(ntstr_mc, 0, 50, 'setup netstream', onNetstream)

			btn_broadcast = new PushButton(ntstr_mc, 0, 50, "broadcast", onBroadcast)
			btn_subscribe = new PushButton(ntstr_mc, btn_broadcast.x +10 + btn_broadcast.width, 50, "subscribe", onSubscribe)
			
			btn_webcam = new PushButton(ntstr_mc, 0,50, 'webcam',onWebcam)
			btn_broadcast.visible = false
			btn_subscribe.visible = false
			btn_webcam.visible = false
			btn_netstream.visible = false
			
		}
		
		
		private function gui_GroupSpecifier():void 
		{
			grpspf_mc = new MovieClip()
			stage.addChild(grpspf_mc)
			
			label_GroupSpecifier = new Label(grpspf_mc, 0, 0, "GroupSpecifier")
			label_name = new Label(grpspf_mc, 0, 20, 'A name for the Group on which all members must agree.')
			it_groupSpecieferName = new InputText(grpspf_mc, label_name.x+label_name.width, label_name.y, 'thename', update)
			cb_ipMulticastMemberUpdatesEnabled = new CheckBox(grpspf_mc, 0, 50, "ipMulticastMemberUpdatesEnabled : Boolean", update)
			cb_ipMulticastMemberUpdatesEnabled.selected = true
			label_ipMulticastMemberUpdatesEnabled = new Label(grpspf_mc, 0, 60, "Specifies whether information about group membership can be exchanged on IP multicast sockets.")
			cb_multicastEnabled = new CheckBox(grpspf_mc, 0, 90, "multicastEnabled : Boolean", update)
			label_multicastEnabled = new Label(grpspf_mc, 0, 100, "Specifies whether streaming is enabled for the NetGroup.")
			cb_objectReplicationEnabled = new CheckBox(grpspf_mc, 0, 130, "objectReplicationEnabled : Boolean", update)
			label_objectReplicationEnabled = new Label(grpspf_mc, 0, 140, "Specifies whether object replication is enabled for the NetGroup.")
			cb_peerToPeerDisabled = new CheckBox(grpspf_mc, 0, 170, "peerToPeerDisabled : Boolean", update)
			label_peerToPeerDisabled= new Label(grpspf_mc, 0, 180, "Specifies whether peer-to-peer connections are disabled for the NetGroup or NetStream.")
			cb_postingEnabled = new CheckBox(grpspf_mc, 0, 210, "postingEnabled : Boolean", update)
			label_postingEnabled = new Label(grpspf_mc, 0, 220, "Specifies whether posting is enabled for the NetGroup.")
			cb_routingEnabled = new CheckBox(grpspf_mc, 0, 250, "routingEnabled : Boolean", update)
			label_routingEnabled = new Label(grpspf_mc, 0, 260, "Specifies whether directed routing methods are enabled for the NetGroup.")
			cb_serverChannelEnabled = new CheckBox(grpspf_mc, 0, 290, "serverChannelEnabled : Boolean", update)
			
			label_serverChannelEnabled = new Label(grpspf_mc, 0, 300, "Specifies whether members of the NetGroup can open a channel to the server.")
			
			cb_routingEnabled.selected = true
			cb_multicastEnabled.selected = true
			cb_serverChannelEnabled.selected = true
			cb_postingEnabled.selected = true
			cb_objectReplicationEnabled.selected = true
			
		}

		private function ruis():void 
		{
			perlinNoise_number ++
			if(perlinNoise_number > 10)perlinNoise_number = 1
			
			if 	(!_broadcasting)
			{
				bmpd_ruis_local.perlinNoise(5,5,1,perlinNoise_number,false, true,1, true)
			}
			perlinNoise_number ++
			if	(!_subsribed)
			{
				bmpd_ruis_other.perlinNoise(5,5,1,perlinNoise_number,false, true,1, true)
			}
		}

		private function setup_groupspec():void 
		{
			groupspec = new GroupSpecifier('myGroup/'+it_groupSpecieferName.text)
			groupspec.ipMulticastMemberUpdatesEnabled = cb_ipMulticastMemberUpdatesEnabled.selected
			groupspec.multicastEnabled = cb_multicastEnabled.selected
			groupspec.objectReplicationEnabled = cb_objectReplicationEnabled.selected
			groupspec.peerToPeerDisabled = cb_peerToPeerDisabled.selected
			groupspec.postingEnabled = cb_postingEnabled.selected
			groupspec.routingEnabled = cb_routingEnabled.selected
			groupspec.serverChannelEnabled = cb_serverChannelEnabled.selected
		}
		private function setup_stream():void
		{
			stream = new NetStream(nc,groupspec.groupspecWithAuthorizations())
			stream.addEventListener(NetStatusEvent.NET_STATUS, netStatus);
		}
		private function setup_group():void 
		{
			group = new NetGroup(nc, groupspec.groupspecWithAuthorizations())
			group.addEventListener(NetStatusEvent.NET_STATUS, netStatus);
			
		}
		private function setup_camera():void 
		{
			if (!_webcam)
			{
				camera = Camera.getCamera();
				microphone = Microphone.getMicrophone();
				camera.setMode(320, 240, 12, false);
				camera.setQuality(0, 100);
				camera.setKeyFrameInterval(12);
				microphone.rate = 11;
				microphone.setSilenceLevel(0);
			
				camera.addEventListener(ActivityEvent.ACTIVITY,onACTIVITY)
				video.attachCamera(camera);
				
			}
		}
		//______________________________________________________________________________________________actions from pushbuttons
		private function onPost(e:Event):void
		{
			try{
			var message:Object = new Object();
			message.user = it_postingName.text
			message.text = it_postingMessage.text
			
			switch (e.target.label)
			{
				case 'post to all':
				group.post(message)
				break
				
				case 'sendToNeighbor':
				var a:String = group.sendToNearest(message, group.convertPeerIDToGroupAddress(otherIDs[l_otherID.selectedIndex]))	
				info = a
				if (a == 'no route')
				{
					info = 'select other id first'
				}
				
				break
			}
			
			}catch(e:Error){}
			
		}
		
		private function onNetstream(e:Event):void
		{
			setup_groupspec()
			setup_group()
			setup_stream()
			
		}
		private function onWebcam(e:Event):void
		{
			setup_camera()
		}
		private function onBroadcast(e:Event):void
		{
			_broadcast()
			_broadcasting = true
		}
		private function onSubscribe(e:Event):void
		{
			
			_receive()
			_subsribed = true
			bmp_ruis_other.visible = false
		}
		private function onConnect(e:Event):void
		{
			var _url:String = it_protocol_server.text +'://'+ it_ip_server.text
			if (it_devkey_server.text.length > 2)
			{
				_url += '/'+ it_devkey_server.text
			}
			if (e.type != 'try again')
			{
				info = 'try to connect '+_url
			}
			else
			{
				info = 'trying AGAIN '+_url
			}
			nc = new NetConnection()
			nc.addEventListener(NetStatusEvent.NET_STATUS, netStatus)
			nc.addEventListener(IOErrorEvent.IO_ERROR, netStatus_IO_ERROR)
			nc.addEventListener(SecurityErrorEvent.SECURITY_ERROR, netStatus_SECURITY_ERROR)
			nc.connect(_url)
		
			
		}
		private function ondisConnect(e:Event):void
		{
			if (_webcam)
			{
			video.attachCamera(null)
			stream.attachCamera(camera);
			stream.close()
			}
			nc.close()
		}
		
		private function _broadcast():void 
		{
			stream.attachCamera(camera);
			stream.publish(it_streamName.text);
		}
		
		
		private function _receive():void 
		{
			
			stream.play(it_streamName.text);
			video.attachNetStream(stream);
			videoScreen_other.addChild(video)
			
		}
		
		
		private function onACTIVITY(e:ActivityEvent):void 
		{
			if (e.activating == true)
			{
				camera.removeEventListener(ActivityEvent.ACTIVITY, onACTIVITY)
				videoScreen_local.addChild(video)
				_webcam = true
				bmp_ruis_local.visible = false
				
				btn_broadcast.visible = true
				btn_webcam.visible = false
				//_broadcast()
			}
			
		}
		
	
		
		//_________________________________________________________________________________________________EVENTS
		private function netStatus(e:NetStatusEvent):void 
		{
			//NetStream.Play.Failed
			
			//info = 'net status'
			info = e.info.code
			
			switch (e.info.code) 
			{	
				case  'NetConnection.Connect.Failed':
				info = 'retrying soon'
				setTimeout(onConnect, 5000, new Event('try again'))
				break;
				
				case 'NetConnection.Connect.Success':
				_connected = btn_netstream.visible = true
				break;
				
				case 'NetConnection.Connect.Closed':
				_connected = _broadcasting = _subsribed = false;
				bmp_ruis_local.visible = bmp_ruis_other.visible = true
				btn_webcam.visible = btn_subscribe.visible = btn_broadcast.visible = false;
				btn_netstream.visible = false;
				break;
				
				case 'NetStream.Connect.Success':
				t_myID.text = nc.nearID
				btn_netstream.visible = false;
				info = 'camera ?' + String(_webcam)
				btn_webcam.visible = btn_subscribe.visible = true
				break;
				
				case 'NetStream.Connect.Success':
				break;
				
				case 'NetStream.Connect.Disconnect':
				break;
				
				case 'NetGroup.Posting.Notify':
				info = e.info.message.user +'> '+e.info.message.text
				break;
				
				case 'NetGroup.SendTo.Notify':
				info = e.info.message.user +'> '+e.info.message.text
				break;
				
				case 'NetGroup.Neighbor.Disconnect':
				update_otherIDS(e.info.peerID)
				l_otherID.items = otherIDs
				break;
				
				case 'NetGroup.Neighbor.Connect':
				otherIDs.push(e.info.peerID)
				l_otherID.items = otherIDs
				break;
				
				case 'NetStream.Publish.Start':
				btn_webcam.visible = btn_broadcast.visible = btn_subscribe.visible = false	
				break;
				
				case 'NetStream.Play.Start':
				btn_webcam.visible = btn_broadcast.visible = btn_subscribe.visible = false	
				break;
				
				case "NetGroup.Replication.Fetch.SendNotify": // e.info.index
				//info = ("____ index: "+e.info.index);
					
				break;
				
				case 'NetGroup.Replication.Fetch.Failed':
				info = 'NetGroup.Replication.Fetch.Failed'
				break;
				
				case "NetGroup.Replication.Request": // e.info.index, e.info.requestID
				group.writeRequestedObject(e.info.requestID,p2pSharedObject.chunks[e.info.index])
				//
				
				info = ("____ ID: "+e.info.requestID+", index: "+e.info.index);
				break;
			
				case "NetGroup.Replication.Fetch.Result": // e.info.index, e.info.object
					info = ("____ index: "+e.info.index);
					
					group.addHaveObjects(e.info.index,e.info.index);
					
					
					p2pSharedObject.chunks[e.info.index] = e.info.object;
					trace( e.info.object)
					info = 'fetch' + e.info.index
					
					if(e.info.index == 0){
						p2pSharedObject.packetLenght = Number(e.info.object);
						info = ("p2pSharedObject.packetLenght: "+p2pSharedObject.packetLenght);
						receiveObject(1);
						
					}else{
						if(e.info.index+1<p2pSharedObject.packetLenght){
							receiveObject(e.info.index + 1);
							
						}else{
							info = ("Receiving DONE" + p2pSharedObject.name);
							info = ("p2pSharedObject.packetLenght: "+p2pSharedObject.packetLenght);
							
							p2pSharedObject.data = new ByteArray();
							
							for(var i:int = 1;i<p2pSharedObject.packetLenght;i++){
								p2pSharedObject.data.writeBytes(p2pSharedObject.chunks[i]);
							}
							group.removeWantObjects(0,p2pSharedObject.packetLenght )
							trace(p2pSharedObject.name)
							fileShareComplete(p2pSharedObject.name)
							
						}
					}
					
					
					break;
				
				default:
				info = 'other'
			}
			
		}
		private function fileShareComplete(name:String):void{
				info = ("fileShareComplete" + name );
				
				
				var loader:Loader = new Loader()
				loader.unload();
				loader.loadBytes(p2pSharedObject.data);
				stage.addChild(loader)
			}
			
		private function receiveObject(index:Number):void{
			group.addWantObjects(index,index);
			p2pSharedObject.actualFetchIndex = index;
		}
		
		private function update_otherIDS(removeID:Object):void
		{
			var outputArray:Array = []
				for (var i:int = 0; i < otherIDs.length; i++) 
				{
					if (otherIDs[i] != removeID)
					{
						outputArray.push(otherIDs[i])
						//otherIDs = otherIDs.splice(i, 1)
						
					}
					
				}
				
				otherIDs = outputArray
		}
		
		
		private function netStatus_SECURITY_ERROR(e:SecurityErrorEvent):void 
		{
			info = String(e)
			info = 'netStatus_SECURITY_ERROR'
		}
		
		private function netStatus_IO_ERROR(e:IOErrorEvent):void 
		{
			info = String(e)
			info = 'netStatus_IO_ERROR'
		}
		
		private function update(e:Event):void
		{
			//trace(e.target is CheckBox)
		}
		
		//_________________________________________________________________________________________________ GET SET
		public function set info(value:String):void 
		{
			ta_info.text = value + '\n' + ta_info.text
		}
	}

}