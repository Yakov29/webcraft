import { BLOCK } from "../../blocks.js";
import { Vector } from "../../helpers.js";
import { createNoise3D } from '../../../vendors/simplex-noise.js';
import { impl as alea } from '../../../vendors/alea.js';

export class WorldClientOreGenerator {
    [key: string]: any;

    /**
     * @param {string} seed 
     */
    constructor(seed, poor = true) {
        this.seed = seed.replaceAll('-', '')
        this.ores = [];
        this.random = new alea(seed)
        
        const scale = 16
        const scale_less = 30

        const threshold = .75
        const threshold_less = .775
        const threshold_diamond_less = .8

        this.addOreLayer(20, 20,        scale_less, threshold_diamond_less, poor ? BLOCK.POOR_DIAMOND_ORE.id : BLOCK.DIAMOND_ORE.id)
        this.addOreLayer(30, 30,        scale_less, threshold_less, poor ? BLOCK.POOR_GOLD_ORE.id : BLOCK.GOLD_ORE.id)
        this.addOreLayer(50, 40,        scale, threshold, poor ? BLOCK.POOR_IRON_ORE.id : BLOCK.IRON_ORE.id)
        this.addOreLayer(10, 20,        scale_less, threshold_less, BLOCK.REDSTONE_ORE.id)
        this.addOreLayer(0, Infinity,   scale, threshold, poor ? BLOCK.POOR_COAL_ORE.id : BLOCK.COAL_ORE.id)

    }

    addOreLayer(y, height, scale, threshold, ore_block_id) {
        const seed = this.seed + this.seed
        const s32 = new String(this.random.int32())
        const noise_hi = createNoise3D(new alea(seed.substring(0, 16) + s32).double)
        const noise_lo = createNoise3D(new alea((seed.substring(16, 16) || seed) + s32).double)
        this.ores.push({y, height, scale, threshold, ore_block_id, noise_hi, noise_lo})
    }

    /**
     * @param {Vector} pos 
     * @returns {int}
     */
    generate(pos, default_block_id) {
        if(typeof default_block_id == 'undefined') {
            throw 'error_empty_default_block_id'
        }
        for(let i = 0; i < this.ores.length; i++) {
            const {y, height, scale, threshold, ore_block_id, noise_hi, noise_lo} = this.ores[i]
            if(height != Infinity && Math.abs(pos.y - y) > height) continue
            const nhi = noise_hi(pos.x / scale, pos.y / scale, pos.z / scale);
            const nlo = noise_lo(pos.x / scale, pos.y / scale, pos.z / scale);
            let n = nhi * .5 + nlo * .5
            if(n < 0) n = -n
            if(n > threshold) {

                const nhi = noise_hi(pos.x / scale, pos.y / scale, pos.z / scale);
                return ore_block_id
            }
        }
        return default_block_id;
    }

}