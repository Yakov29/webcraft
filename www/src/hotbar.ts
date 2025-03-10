import { SpriteAtlas } from "./core/sprite_atlas.js";
import { Resources } from "./resources.js";
import { PlayerInventory } from "./player_inventory.js";
import { MySprite, MyTilemap } from "../tools/gui/MySpriteRenderer.js";
import { Effect } from "./block_type/effect.js";
import { Window } from "../tools/gui/wm.js";
import { CraftTableInventorySlot } from "./window/base_craft_window.js";
import { INVENTORY_HOTBAR_SLOT_COUNT } from "./constant.js";

const MAX_NAME_SHOW_TIME = 2000;

//
const LIVE_SHIFT_RANDOM = new Array(1024);
for(let i = 0; i < LIVE_SHIFT_RANDOM.length; i++) {
    LIVE_SHIFT_RANDOM[i] = Math.round(Math.random());
}

//
class Strings {
    [key: string]: any;

    constructor() {
        this.strings = [
            {text: null, set_time: null, measure: null, max_time: null},
            {text: null, set_time: null, measure: null, max_time: null}
        ];
    }

    // set new text
    setText(index, text, max_time) {
        this.strings[index].text = text;
        if(text) {
            this.strings[index].set_time = performance.now();
            this.strings[index].measure = null;
            this.strings[index].max_time = max_time;
        }
    }

    // set text if not same with previous
    updateText(index, text, max_time) {
        if(this.strings[index].text == text) {
            return false;
        }
        this.setText(index, text, max_time);
    }

    // draw
    draw(window, window_shadow) {

        const texts = []

        // draw strings on center of display
        for(let i = 0; i < this.strings.length; i++) {
            const item = this.strings[i];
            if(!item.text) {
                continue;
            }
            const time_remains = performance.now() - item.set_time;
            const max_time = item.max_time || MAX_NAME_SHOW_TIME;
            if(time_remains > max_time) {
                continue;
            }
            // Text opacity
            const alpha = Math.min(2 - (time_remains / max_time) * 2, 1);
            let aa = Math.ceil(255 * alpha).toString(16);
            if(aa.length == 1) {
                aa = '0' + aa;
            }
            texts.push(item.text)
        }

        window.text = texts.join('\n')
        window_shadow.text = texts.join('\n')

    }

}

export class Hotbar {
    [key: string]: any;
    sprites: Dict<MySprite> = {};

    constructor(hud) {

        // console.log(new Error().stack)

        this.hud = hud
        this.last_damage_time = null
        this.strings = new Strings()

        // Load hotbar atlases
        const all = []
        all.push(this.effect_icons = new SpriteAtlas().fromFile('./media/gui/inventory2.png'))

        this.icons_atlas = Resources.atlas.get('icons')

        Promise.all(all).then(_ => {

            this.tilemap = new MyTilemap()
            hud.wm.addChild(this.tilemap)

            this.addHotbarText()

            // Init sprites
            const spriteScale: Dict<number> = {

                slot:               1,
                selector:           1,

                live:               0.9,
                live_half:          0.9,
                live_bg_black:      0.9,
                live_bg_white:      0.9,
                live_poison:        0.9,
                live_poison_half:   0.9,

                food_bg_black:      0.9,
                food:               0.9,
                food_half:          0.9,
                food_poison:        0.9,
                food_poison_half:   0.9,

                oxygen:             0.9,
                oxygen_half:        0.9,

                armor_bg_black:     0.9,
                armor:              0.9,
                armor_half:         0.9
            }

            this.hotbar_atlas = Resources.atlas.get('hotbar')

            for(const [name, scale] of Object.entries(spriteScale)) {
                this.sprites[name] = new MySprite(this.hotbar_atlas.getSpriteFromMap(name), scale * this.zoom)
            }

            const bn_atlas = Resources.atlas.get('bn')

            // Effects sprites
            this.effect_sprites = {}
            for(let effect of Effect.get()) {
                this.effect_sprites[effect.id] = new MySprite(bn_atlas.getSpriteFromMap(effect.icon), 1 * this.zoom)
            }

            this.sprite_effect_bg = new MySprite(bn_atlas.getSpriteFromMap('button_black'), 1 * this.zoom)

            this.hud.add(this, 0)

        })

    }

    addHotbarText() {

        const hud = this.hud

        // Hotbar text in center of screen
        hud.wm._wmoverlay.add(this.lblHotbarTextShadow = new Window(0, 0, 0, 0, 'lblHotbarText', undefined, 'Lang.loading'))
        this.lblHotbarTextShadow.catchEvents = false
        this.lblHotbarTextShadow.style.textAlign.horizontal = 'center'
        this.lblHotbarTextShadow.style.textAlign.vertical = 'bottom'
        this.lblHotbarTextShadow.style.font.color = '#00000055'

        // Hotbar text in center of screen
        hud.wm._wmoverlay.add(this.lblHotbarText = new Window(0, 0, 0, 0, 'lblHotbarText', undefined, 'Lang.loading'))
        this.lblHotbarText.catchEvents = false
        this.lblHotbarText.style.textAlign.horizontal = 'center'
        this.lblHotbarText.style.textAlign.vertical = 'bottom'
        this.lblHotbarText.style.font.color = '#ffffff'

        // const fs = this.lblHotbarText.text_container.style
        // fs.stroke = '#00000099'
        // fs.strokeThickness = 4
        // fs.lineHeight = UI_ZOOM * 20
        //
        // fs.dropShadow = true
        // fs.dropShadowAlpha = 1
        // fs.dropShadowBlur = 4
        // fs.dropShadowAngle = 0 // Math.PI / 6
        // fs.dropShadowColor = 0x0
        // fs.dropShadowDistance = 0
    }

    /**
    * Создание слотов для инвентаря
    * @param int sz Ширина / высота слота
    */
    createInventorySlots(sz) {

        sz *= this.zoom

        const inventory_slots = this.inventory_slots = new Window(0, 0, INVENTORY_HOTBAR_SLOT_COUNT * sz, sz, 'hotbar_inventory_slots')
        // inventory_slots.style.background.color = '#00000044'
        inventory_slots.auto_center = false
        inventory_slots.catchEvents = false

        for(let i = 0; i < INVENTORY_HOTBAR_SLOT_COUNT; i++) {
            const lblSlot = new CraftTableInventorySlot(i * sz, 0, sz, sz, `lblSlot${i}`, null, null, this, i)
            inventory_slots.add(lblSlot)
        }
        this.hud.wm.addChild(inventory_slots)

    }

    get zoom() {
        return UI_ZOOM
    }

    /**
     * @param {PlayerInventory} inventory
     */
    setInventory(inventory) {

        this.inventory = inventory

        this.createInventorySlots(40)
    }

    //
    damage(damage_value, reason_text) {
        this.last_damage_time = performance.now();
        console.error('error_not_implemented', damage_value, reason_text);
        this.inventory.player.world.server.ModifyIndicator('live', -damage_value, reason_text);
    }

    setState(new_state) {
        for(const [key, value] of Object.entries(new_state)) {
            this[key] = value;
        }
    }

    // выводит полосу
    drawStrip(x, y, val, full, half, bbg = null, wbg = null, blink = false, wave = false, reverse = false) {
        const size = full.width
        val /= 2
        const spn = Math.round(performance.now() / 75)
        if (bbg) {
            const bg = blink ? wbg : bbg
            for (let i = 0; i < 10; i++) {
                const sy = wave ? LIVE_SHIFT_RANDOM[(spn + i) % LIVE_SHIFT_RANDOM.length] * 5 : 0
                bg.x = x + ((reverse) ? i * size : (size * 9 - i * size))
                bg.y = y + sy
                this.tilemap.drawImage(bg)
            }
        }
        for (let i = 0; i < 10; i++) {
            const sy = wave ? LIVE_SHIFT_RANDOM[(spn + i) % LIVE_SHIFT_RANDOM.length] * 5 : 0
            const d = val - 0.5
            if ( d > i) {
                full.x = x + ((!reverse) ? i * size : (size * 9 - i * size))
                full.y = y + sy
                this.tilemap.drawImage(full)
            } else if (d == i) {
                half.x = x + ((!reverse) ? i * size : (size * 9 - i * size))
                half.y = y + sy
                this.tilemap.drawImage(half)
            }
        }
    }

    drawHUD(hud) {

        this.tilemap.clear()

        const player  = this.inventory.player;

        const visible = !player.game_mode.isSpectator() && hud.isActive()

        this.inventory_slots.visible = visible

        if(!visible) {
            return false;
        }

        // Inventory slots
        this.inventory_slots.transform.position.set(hud.width / 2 - this.inventory_slots.w / 2, hud.height - this.inventory_slots.h - 6 * this.zoom)
        if(this.inventory_update_number != this.inventory.update_number) {
            this.inventory_update_number = this.inventory.update_number
            this.inventory_slots.children.map(w => {
                if(w instanceof CraftTableInventorySlot) {
                    w.setItem(w.getItem(), false)
                }
            })
        }

        let hotbar_height = 0

        const mayGetDamaged = player.game_mode.mayGetDamaged();
        if (mayGetDamaged) {
            const left = 180 * this.zoom
            const right = 15 * this.zoom
            const bottom_one_line = 70 * this.zoom
            const bottom_two_line = 90 * this.zoom
            hotbar_height = bottom_two_line
            const diff = Math.round(performance.now() - Qubatch.hotbar.last_damage_time);
            // жизни
            const live = player.indicators.live.value;
            // моргание от урона
            const is_damage = (diff > 0 && diff < 100 || diff > 200 && diff < 300)
            const low_live = live < 3
            if (player.getEffectLevel(Effect.POISON) > 0) {
                this.drawStrip(hud.width / 2 - left, hud.height - bottom_one_line , live, this.sprites.live_poison, this.sprites.live_poison_half, this.sprites.live_bg_black, this.sprites.live_bg_white, is_damage, low_live)
            } else {
                this.drawStrip(hud.width / 2 - left, hud.height - bottom_one_line , live, this.sprites.live, this.sprites.live_half, this.sprites.live_bg_black, this.sprites.live_bg_white, is_damage, low_live)
            }
            // еда
            const food = player.indicators.food.value;
            if (player.getEffectLevel(Effect.HUNGER) > 0) {
                this.drawStrip(hud.width / 2 + right, hud.height - bottom_one_line , food, this.sprites.food_poison, this.sprites.food_poison_half, this.sprites.food_bg_black, null, false, false, true);
            } else {
                this.drawStrip(hud.width / 2 + right, hud.height - bottom_one_line , food, this.sprites.food, this.sprites.food_half, this.sprites.food_bg_black, null, false, false, true);
            }
            // кислород
            const oxygen = player.indicators.oxygen.value;
            if (oxygen < 20) {
                this.drawStrip(hud.width / 2 + right,  hud.height - bottom_two_line, oxygen, this.sprites.oxygen, this.sprites.oxygen_half, null, null, false, false, true)
            }
            // броня
            const armor = this.inventory.getArmorLevel()
            if (armor > 0) {
                this.drawStrip(hud.width / 2 - left, hud.height - bottom_two_line, armor, this.sprites.armor, this.sprites.armor_half, this.sprites.armor_bg_black)
            }
        }

        // хотбар и селектор
        const sx = this.sprites.slot.width
        const sy = this.sprites.slot.height + 5 * this.zoom
        for (let i = 0; i < 9; i++) {
            this.tilemap.drawImage(this.sprites.slot, (hud.width - sx * 9) / 2 + i * sx, hud.height - sy)
        }
        for (let i = 0; i < 9; i++) {
            if (i == this.inventory.getRightIndex()) {
                this.tilemap.drawImage(this.sprites.selector, (hud.width - sx * 9) / 2 + i * sx - 2 * this.zoom, hud.height - sy - 2 * this.zoom)
            }
        }

        if(hotbar_height == 0) {
            hotbar_height = sy
        }

        // TODO: pixi
        this.drawEffects(hud)

        // Draw strings
        this.lblHotbarText.w = hud.width
        this.lblHotbarText.h = hud.height
        this.lblHotbarTextShadow.w = hud.width + 3
        this.lblHotbarTextShadow.h = hud.height + 3

        this.lblHotbarText.style.padding.bottom = hotbar_height + 10 * this.zoom
        // this.lblHotbarTextShadow.style.padding.left = 2 * this.zoom
        this.lblHotbarTextShadow.style.padding.bottom = hotbar_height + 10 * this.zoom

        this.strings.draw(this.lblHotbarText, this.lblHotbarTextShadow)

    }

    drawEffects(hud) {
        const margin = 4 * this.zoom
        let pos = margin
        const bg = this.sprite_effect_bg
        for(let effect of this.inventory.player.effects.effects) {
            const sprite = this.effect_sprites[effect.id]
            const paddingx = bg.width / 2 - sprite.width / 2
            const paddingy = bg.height / 2 - sprite.height / 2
            const x = hud.width - pos - bg.width
            const y = margin
            this.tilemap.drawImage(bg, x, y)
            this.tilemap.drawImage(sprite, x + paddingx, y + paddingy)
            pos += margin + bg.width
        }
    }

}