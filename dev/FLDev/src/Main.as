package 
{
  import com.bit101.components.HBox;
  import com.bit101.components.InputText;
  import com.bit101.components.Label;
  import com.bit101.components.List;
  import com.bit101.components.ListItem;
  import com.bit101.components.Panel;
  import com.bit101.components.PushButton;
  import com.bit101.components.ScrollPane;
  import com.bit101.components.Style;
  import com.bit101.components.TextArea;
  import com.bit101.components.VBox;
  import com.bit101.components.Window;
  import flash.display.Sprite;
  import flash.display.StageAlign;
  import flash.display.StageScaleMode;
  import flash.events.Event;
  import flash.events.MouseEvent;
  import flash.events.NetStatusEvent;
  import flash.net.NetConnection;
	
	/**
	 * ...
	 * @author me
	 */
	public class Main extends Sprite 
	{
		//Connections
    private var connectionWindow:Window;
    private var serverURI:InputText;
    private var connectionsList:List;
    private var connections:Array = new Array();
    
    //Menu
    private var leftMenu:VBox;
    private var bottomMenu:HBox;
    private var output:TextArea;
    
    //left menu buttons
    private var showHideConnections:PushButton;
    private var showHideMethod:PushButton;
    
    //bottom menu buttons
    private var clearOutputButton:PushButton;
    
		public function Main():void 
		{
			if (stage) init();
			else addEventListener(Event.ADDED_TO_STAGE, init);
		}
		
		private function init(e:Event = null):void 
		{
			removeEventListener(Event.ADDED_TO_STAGE, init);
      stage.scaleMode = StageScaleMode.NO_SCALE;
      stage.align = StageAlign.TOP_LEFT;
      
      stage.addEventListener(Event.RESIZE, resize);
      
      //Init components
      Style.LABEL_TEXT = 0x086A87;
      
      //Button list on the left
      leftMenu = new VBox(this, 10, 10);
      bottomMenu = new HBox(this, 0, stage.stageHeight - 20);
      clearOutputButton = new PushButton(bottomMenu, 0, 0, 'clear output');
      clearOutputButton.addEventListener(MouseEvent.CLICK, function():void {
        output.text = '';
      });
      
      //Connections
      connectionWindow = new Window(this, 120, 10, 'Connections');
      connectionWindow.color = 0xffffff;
      connectionWindow.setSize(250, 400);
      var uriLabel:Label = new Label(connectionWindow, 5, 5, 'Server Address');
      serverURI = new InputText(connectionWindow, 95, 5, 'rtmfp://');
      serverURI.width = 150
      var connect:PushButton = new PushButton(connectionWindow, 5, 25, 'Create New Connection');
      connect.width = 240;
      connect.addEventListener(MouseEvent.CLICK, addConnection);
      connectionsList = new List(connectionWindow, 5, 50);
      connectionsList.setSize(240, 300);
      var closeConnectionButton:PushButton = new PushButton(connectionWindow, 5, 355, 'Close selected Connection');
      closeConnectionButton.width = 240;
      closeConnectionButton.addEventListener(MouseEvent.CLICK, function():void
      {
        if(connectionsList.selectedItem != null){
          writeOut('Closing connection ' + connectionsList.selectedItem.num);
          connectionsList.selectedItem.close();
        }
      });
      
      showHideConnections = new PushButton(leftMenu, 0, 0, 'Connections');
      showHideConnections.toggle = true;
      showHideConnections.selected = true;
      showHideConnections.addEventListener(MouseEvent.CLICK, function():void {
        connectionWindow.visible = !connectionWindow.visible;
      });
      
      output = new TextArea(this, 0, stage.stageHeight - 200);
      output.height = 200;
      
      showHideMethod = new PushButton(leftMenu, 0, 0, 'Method');
      showHideMethod.toggle = true;
      showHideMethod.enabled = false;
      
      resize(null);
		}
    
    private function addConnection(evt:MouseEvent):void 
    {
      var nc:Connection = new Connection();
      nc.addEventListener(NetStatusEvent.NET_STATUS, connectionStatusListener);
      nc.connect(serverURI.text);
      nc.label = nc.num + ' to ' + serverURI.text;
      connections.push(nc);
      connectionsList.addItem(nc);
    };
    
    private function connectionStatusListener(evt:NetStatusEvent):void
    {
      writeOut('Connection ' + evt.target.num + ' status: ' + evt.info.code);
      if (evt.info.code == 'NetConnection.Connect.Closed' || evt.info.code == 'NetConnection.Connect.Failed')
      {
        connectionsList.removeItemAt(connectionsList.items.indexOf(evt.target));
      }
    }
    
    private function writeOut(str:String):void {
      output.text = str + '\n' + output.text;
    }
    
    private function resize(evt:Event):void
    {
      output.width = stage.stageWidth;
      output.y = stage.stageHeight - 220;
      bottomMenu.y = stage.stageHeight - 20;
    }
		
	}
	
}