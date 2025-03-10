import { FSMBrain } from "../brain.js";
import { BLOCK } from "../../../www/js/blocks.js";
import { Vector } from "../../../www/js/helpers.js";
import { WorldAction } from "../../../www/js/world_action.js";
import { EnumDamage } from "../../../www/js/enums/enum_damage.js";
import { ServerClient } from "../../../www/js/server_client.js";

export class Brain extends FSMBrain {

    constructor(mob) {
        super(mob);
        this.prevPos        = new Vector(mob.pos);
        this.lerpPos        = new Vector(mob.pos);
        this.pc             = this.createPlayerControl(this, {
            baseSpeed: 1/4,
            playerHeight: 1.3,
            stepHeight: 1,
            playerHalfWidth: .45
        });
        this.stack.pushState(this.doStand);
        this.health = 8; // максимальное здоровье
        this.distance_view = 6; // дистанция на которм виден игрок
        this.count_grass = 0;  // количество травы
        this.targets = [
            mob.getWorld().block_manager.WHEAT.id
        ];
    }

    get is_shaered() {
        return !!this.mob.extra_data?.is_shaered;
    }

    set is_shaered(value) {
        this.mob.extra_data.is_shaered = value;
    }
    
    // просто стоит и кушает траву, если голодная
    doStand(delta) {
        super.doStand(delta);
        if (this.is_shaered && Math.random() < 0.8) {
            this.stack.replaceState(this.doEat);
        }
    }
    
    // ест траву
    doEat(delta) {
        const mob = this.mob;
        const world = mob.getWorld();
        const bm = world.block_manager
        if (this.count_grass > 5) {
            this.count_grass = 0;
            this.is_shaered = false;
        }
        if (this.is_shaered) {
            if (this.legs_id == bm.TALL_GRASS.id) {
                const actions = new WorldAction();
                actions.addBlocks([
                    {
                        pos: mob.pos.floored(), 
                        item: {id : bm.AIR.id}, 
                        action_id: ServerClient.BLOCK_ACTION_REPLACE
                    }
                ]);
                world.actions_queue.add(null, actions); 
                this.count_grass++;
            } else {
                if (this.under_id == bm.GRASS_BLOCK.id) {
                    const actions = new WorldAction();
                    actions.addBlocks([
                        {
                            pos: mob.pos.offset(0, -1, 0).floored(), 
                            item: {id : bm.DIRT.id}, 
                            action_id: ServerClient.BLOCK_ACTION_REPLACE
                        }
                    ]);
                    world.actions_queue.add(null, actions); 
                    this.count_grass++;
                }
            }
        }
        this.stack.replaceState(this.doForward);
    }
    
    // Если убили моба
    onKill(actor, type_damage) {
        const mob = this.mob;
        const world = mob.getWorld();
        const items = [];
        const actions = new WorldAction();
        const rnd_count_mutton = (Math.random() * 2) | 0;
        const bm = world.block_manager
        items.push({ id: type_damage != EnumDamage.FIRE ? bm.MUTTON.id : bm.COOKED_MUTTON.id, count: rnd_count_mutton + 1 });
        if (!this.is_shaered) {
            const drop_block = world.block_manager.fromName('WHITE_WOOL');
            items.push({ id: drop_block.id, count: 1 });
        }
        actions.addDropItem({ pos: mob.pos, items: items, force: true });
        actions.addPlaySound({ tag: 'madcraft:block.sheep', action: 'death', pos: mob.pos.clone() });
        world.actions_queue.add(actor, actions);
    }
    
    // если использовали предмет
    onUse(actor, id) {
        if (!actor || !id){
            return;
        }
        
        const mob = this.mob;
        const world = mob.getWorld();
        const bm = world.block_manager
        
        if (id == bm.SHEARS.id && !this.is_shaered) {
            this.is_shaered = true;
            const actions = new WorldAction();

            const rnd_count = ((Math.random() * 2) | 0) + 1;
            const drop_block = world.block_manager.fromName('WHITE_WOOL');
            actions.addDropItem({ pos: mob.pos, items: [{ id: drop_block.id, count: rnd_count }] });
            world.actions_queue.add(actor, actions);
            return true;
        }
        return false;
    }
    
}