import {ServerClient} from "../../../www/js/server_client.js";

export class CMD_PICKAT_ACTION {
    constructor(player, data){
		if (data.destroyBlock == true)
		{
			//player.state.stats.pickat++;
		}
        player.world.pickAtAction(player, data);
    }
}