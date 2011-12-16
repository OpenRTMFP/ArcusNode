package  
{
	import flash.display.Sprite;
	import flash.events.Event;
	import flash.events.NetStatusEvent;
	import flash.net.NetConnection;
	import flash.net.Responder;
	
	/**
	 * ...
	 * @author Sebastian Herrlinger
	 */
	public class CommandTest extends Sprite 
	{
		private var nc:NetConnection = null;
		
		public function CommandTest() 
		{
			if (stage) init();
			else addEventListener(Event.ADDED_TO_STAGE, init);
		}
		
		private function init(e:Event = null):void 
		{
			nc = new NetConnection();
			nc.addEventListener(NetStatusEvent.NET_STATUS, netStatus);
			nc.connect('rtmfp://192.168.73.129');
		}
		
		private function netStatus(evt:NetStatusEvent):void
		{
			var responder:Responder = new Responder(function(response) {
			  trace(response.what); //-> 'ArcusNode rocks!'
			});
			nc.call('sayWhat', responder, { name: 'ArcusNode' });
		}
		
	}

}