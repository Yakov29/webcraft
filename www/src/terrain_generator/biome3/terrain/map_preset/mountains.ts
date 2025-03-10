import { Mth, Vector } from "../../../../helpers.js";
import { DENSITY_AIR_THRESHOLD } from "../manager.js";
import { ClimateParams, DensityParams, MapCellPreset } from "../manager_vars.js";

export class MapCellPreset_Mountains extends MapCellPreset {
    [key: string]: any;

    constructor() {
        super('mountains', {chance: 4, relief: 4, mid_level: 6})
        this.max_height = 150;
        this.noise_scale = 200
        this.climate = new ClimateParams(.6, .75) // Лес
    }

    /**
     * @param { Vector } xz
     * @param { ClimateParams } params
     * @returns { boolean }
     */
    modifyClimate(xz, params) {
        params.temperature = this.climate.temperature
        params.humidity = this.climate.humidity
        return true
    }

    /**
     * @param {Vector} xyz
     * @param {TerrainMapCell} cell
     * @param {float} dist_percent
     * @param {*} generator_options
     * @param {*} noise2d
     * @param {DensityParams} result
     *
     * @returns {DensityParams}
     */
    calcDensity(xyz, cell, dist_percent, noise2d, generator_options, result) {

        if(cell.mountains_max_height === undefined) {
            const HEIGHT_SCALE = this.max_height * dist_percent;
            cell.mountains_height =  generator_options.WATER_LINE +
                this.mountainFractalNoise(
                    noise2d,
                    xyz.x/3, xyz.z/3,
                    4, // -- Octaves (Integer that is >1)
                    3, // -- Lacunarity (Number that is >1)
                    0.35, // -- Persistence (Number that is >0 and <1)
                    this.noise_scale,
                ) * HEIGHT_SCALE;
        }

        const density = Mth.clamp(DENSITY_AIR_THRESHOLD + (cell.mountains_height - xyz.y) / 64, 0, 1)

        // add some roughness
        result.density = density + result.d3 / 7.5

        // cheese holes
        // if(result.density > .7) {
        //     if((result.d2 + result.d3 * .1 + result.d4 * .2) > .5) {
        //         result.density = DENSITY_AIR_THRESHOLD;
        //     }
        // }

        return result

    }

    // Шум для гор
    mountainFractalNoise(noise2d, x, y, octaves, lacunarity, persistence, scale) {
        // The sum of our octaves
        let value = 0
        // These coordinates will be scaled the lacunarity
        let x1 = x
        let y1 = y
        // Determines the effect of each octave on the previous sum
        let amplitude = 1
        for (let i = 1; i < octaves; i++) {
            // Multiply the noise output by the amplitude and add it to our sum
            value += noise2d(x1 / scale, y1 / scale) * amplitude;
            // Scale up our perlin noise by multiplying the coordinates by lacunarity
            y1 *= lacunarity
            x1 *= lacunarity
            // Reduce our amplitude by multiplying it by persistence
            amplitude *= persistence
        }
        // It is possible to have an output value outside of the range [-1,1]
        // For consistency let's clamp it to that range
        return Math.abs(value); // Helpers.clamp(value, -1, 1)
    }

}