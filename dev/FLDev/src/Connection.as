package  
{
	import flash.net.NetConnection;
	
	/**
   * ...
   * @author me
   */
  public class Connection extends NetConnection 
  {
    private static var counter:Number = 0;
    
    public var num:Number = 0;
    public var label:String = '';
    
    public function Connection() 
    {
      counter++;
      num = counter;
      label = 'Connection ' + num;
    }
    
  }

}