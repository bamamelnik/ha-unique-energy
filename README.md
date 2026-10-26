# ha-unique-energy

A Home Assistant dashboard card that shows live energy flows — PV, grid, home
battery, heat pump, wallbox and up to two cars — as animated dots over a
low-poly isometric picture of a house.

![Screenshot](screenshot.jpg)

The picture is built from layers: a base image plus one transparent PNG per
optional component, so anything you don't have (battery, barn with PV, second
car, …) simply disappears from the picture. The card ships with a graphical
editor. **The UI is in German.**

## Installation (HACS)

1. HACS → ⋮ → *Custom repositories* → `https://github.com/bamamelnik/ha-unique-energy`, type *Dashboard*.
2. Download *ha-unique-energy*. HACS registers the resource
   `/hacsfiles/ha-unique-energy/ha-unique-energy.js` for you.
3. Add the card *HOS Energiekarte* to a dashboard and configure it in the editor.

## Configuration

```yaml
type: custom:hos-energiekarte
bilder: /hacsfiles/ha-unique-energy/lowpoly   # image set shipped with the card
titel: Energie                                # optional
netz:        { leistung: sensor.grid_power }       # + = import, − = export
haus:        { leistung: sensor.house_power, abzueglich: sensor.wallbox_power }
pv_haus:     { leistung: sensor.pv_roof_power, string_1: sensor.pv_dc1, string_2: sensor.pv_dc2 }
balkon_pv:   { leistung: sensor.balcony_pv_power }
scheune:     { leistung: sensor.barn_pv_power }     # barn including its PV
akku:        { leistung: sensor.battery_power, soc: sensor.battery_soc }   # + = charging
waermepumpe: { leistung: sensor.heat_pump_power }
wallbox:     { leistung: sensor.wallbox_power }
auto_1:      { name: My car, soc: sensor.car_soc }  # without leistung: uses the wallbox
auto_2:      { leistung: sensor.car2_power }
```

A component is shown when its key is present and does not carry `zeigen: false`.
Grid and house are part of the base image.

| Key | Meaning |
|---|---|
| `leistung` | power sensor; W, kW and MW are read from `unit_of_measurement` |
| `invertieren` | `true` flips the sign |
| `abzueglich` | entity (or list) subtracted before the sign is applied; if one is unavailable the card shows “–” |
| `soc` | state of charge in % (battery, cars) |
| `string_1` … `string_3` | PV only: up to three string sensors, shown in a smaller line above the total; without `leistung` their sum is the total |
| `name` | label text |
| `zeigen` | `false` hides the component but keeps its settings |

`akku` may also be a list of batteries (summed); the editor leaves such a list
untouched, edit it in YAML.

## Credits

The idea of animated flows over a house picture is inspired by
[Lumina Energy Card](https://github.com/Giorgio866/lumina-energy-card). This card
is an independent implementation: no code or graphics were taken from it. The
images were generated for this project.

## License

MIT, see [LICENSE](LICENSE).
