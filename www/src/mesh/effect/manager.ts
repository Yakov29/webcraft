import { makeChunkEffectID, Vector, VectorCollectorFlat } from '../../helpers.js';
import { Mesh_Effect } from '../effect.js';

import { default as Mesh_Effect_Emitter_Block_Destroy } from "./emitter/block_destroy.js";
import { default as Mesh_Effect_Emitter_Campfire_Flame } from "./emitter/campfire_flame.js";
import { default as Mesh_Effect_Emitter_Explosion } from "./emitter/explosion.js";
import { default as Mesh_Effect_Emitter_Music_Note } from "./emitter/music_note.js";
import { default as Mesh_Effect_Emitter_Torch_Flame } from "./emitter/torch_flame.js";
import { default as Mesh_Effect_Emitter_Bubble_Column } from "./emitter/bubble_column.js";
import { default as Mesh_Effect_Emitter_EnderChest } from "./emitter/ender_chest.js";
import { default as Mesh_Effect_Emitter_VillagerHappy } from "./emitter/villager_happy.js";
import { default as Mesh_Effect_Emitter_Cloud } from "./emitter/cloud.js";
import { default as Mesh_Effect_Emitter_Bubble } from "./emitter/bubble.js";
import { default as Mesh_Effect_Emitter_Dripping } from "./emitter/dripping.js";

/**
 * Creates and destroys emitters, places particles generated by emitters in a mesh
 * Создает и уничтожает эмиттеры, помещает сгенерированные эмиттерами частиц в меш
 */
export class Mesh_Effect_Manager {
    [key: string]: any;

    // Init effects
    constructor(mesh_manager) {

        this.mesh_manager = mesh_manager;

        this.emitters = [];
        this.block_emitters = new VectorCollectorFlat();

        // Effect types
        this.effects = new Map();
        this.effects.set('destroy_block', Mesh_Effect_Emitter_Block_Destroy);
        this.effects.set('music_note', Mesh_Effect_Emitter_Music_Note);
        this.effects.set('campfire_flame', Mesh_Effect_Emitter_Campfire_Flame);
        this.effects.set('torch_flame', Mesh_Effect_Emitter_Torch_Flame);
        this.effects.set('explosion', Mesh_Effect_Emitter_Explosion);
        this.effects.set('bubble_column', Mesh_Effect_Emitter_Bubble_Column);
        this.effects.set('ender_chest', Mesh_Effect_Emitter_EnderChest);
        this.effects.set('villager_happy', Mesh_Effect_Emitter_VillagerHappy);
        this.effects.set('cloud', Mesh_Effect_Emitter_Cloud);
        this.effects.set('bubble', Mesh_Effect_Emitter_Bubble);
		this.effects.set('dripping', Mesh_Effect_Emitter_Dripping);
        
        for(const item of this.effects.values()) {
            if(item.textures) {
                for(let i in item.textures) {
                    item.textures[i][0] = (item.textures[i][0] + .5) / 8;
                    item.textures[i][1] = (item.textures[i][1] + .5) / 8;
                    item.textures[i][2] = 1 / 8;
                    item.textures[i][3] = 1 / 8;
                }
            }
        }

    }

    /**
     * 
     */
    createBlockEmitter(args) {
        if(args.type) {
            for(let i = 0; i < args.pos.length; i++) {
                const em = this.effects.get(args.type)
                if(!em) {
                    throw 'error_invalid_particle'
                }
                const pos = new Vector(args.pos[i])
                const emitter = new em(pos, args)
                this.block_emitters.set(args.block_pos, emitter)
            }
        } else if(args.list) {
            const emmiters = []
            for(let item of args.list) {
                const em = this.effects.get(item.type)
                if(!em) {
                    throw 'error_invalid_particle'
                }
                const pos = new Vector(item.pos)
                emmiters.push(new em(pos, item.args))
            }
            if(emmiters.length) {
                this.block_emitters.set(args.block_pos, emmiters)
            }
        }
    }

    /**
     * 
     * @param {Vector} block_pos 
     */
    deleteBlockEmitter(block_pos) {
        this.block_emitters.delete(block_pos);
    }

    /**
     * 
     * @param {*} aabb 
     */
    destroyAllInAABB(aabb) {
        for(let [pos, _] of this.block_emitters.entries(aabb)) {
            this.block_emitters.delete(pos);
        }
    }

    /**
     * Create particle emitter
     * @param {string} name 
     * @param {Vector} pos 
     * @param {*} params 
     * @returns 
     */
    createEmitter(name, pos, params) {
        const em = this.effects.get(name);
        if(!em) {
            throw 'error_invalid_particle';
        }
        const emitter = new em(new Vector(pos), params);
        this.emitters.push(emitter);
        return emitter;
    }

    /**
     * Return or create mesh for separate chunk and material
     * @param {Vector} chunk_addr 
     * @param {string} material_key 
     * @returns {Mesh_Effect}
     */
    getChunkEffectMesh(chunk_addr, material_key) {
        // const material_key = particle.material_key ?? 'extend/transparent/effects';
        const PARTICLE_EFFECTS_ID = makeChunkEffectID(chunk_addr, material_key);
        let effect_mesh = this.mesh_manager.get(PARTICLE_EFFECTS_ID);
        if(!effect_mesh) {
            effect_mesh = new Mesh_Effect(this, chunk_addr, material_key);
            this.mesh_manager.add(effect_mesh, PARTICLE_EFFECTS_ID);
        }
        return effect_mesh;
    }

    /**
     * 
     * @param {float} delta in ms
     * @param {Vector} player_pos 
     */
    tick(delta, player_pos) {

        //
        let len = 0;
        for(let i = 0; i < this.emitters.length; i++) {
            const emitter = this.emitters[i];
            if(!emitter.canDelete()) {
                const particles = emitter.emit();
                if (!particles) {
                    continue;
                }
                for(let particle of particles) {
                    const mesh = this.getChunkEffectMesh(emitter.chunk_addr, particle.material_key);
                    mesh.add(particle);
                }
                this.emitters[len++] = emitter;
            }
        }
        this.emitters.length = len;

        for(let emitter of this.block_emitters) {
            if(Array.isArray(emitter)) {
                for(let i = 0; i < emitter.length; i++) {
                    this.runEmmiter(emitter[i], player_pos)
                }
            } else {
                this.runEmmiter(emitter, player_pos)
            }
        }

    }

    /**
     * @param {*} emitter 
     * @param {Vector} player_pos 
     */
    runEmmiter(emitter, player_pos) {
        if(player_pos.distance(emitter.pos) < emitter.max_distance) {
            const particles = emitter.emit()
            if (!particles) {
                return
            }
            for(let particle of particles) {
                const mesh = this.getChunkEffectMesh(emitter.chunk_addr, particle.material_key)
                mesh.add(particle)
            }
        }
    }

}