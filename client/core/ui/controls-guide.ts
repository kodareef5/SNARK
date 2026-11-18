// Descriptions of implemented actions, with explicit context. These do not promise ARK's absent radial menus.
export const CONTROL_GROUPS=["Move","Combat","World","Build","Flight","Menus"] as const;
export interface Binding { title: string; detail: string; group: number }
const b=(group:number,title:string,detail=""):Binding=>({group,title,detail});
const KEYS: Readonly<Record<string,Binding>>={
  KeyK:b(2,"Orbit camera / patrol lights","On foot, riding or as a passenger, swing the camera round you or your mount without turning; the wheel moves it nearer or further, and K again returns to your view. In a patrol vehicle’s driver’s seat, cycle the lights: off, patrol, response and pursuit. Other drivers already turn the chase camera with the mouse."),
  KeyW:b(0,"Forward"),KeyA:b(0,"Strafe left"),KeyS:b(0,"Back"),KeyD:b(0,"Strafe right"),ShiftLeft:b(0,"Sprint","Hold while moving. Sprint stands up from crouch."),
  Space:b(0,"Jump","From crouch or prone, press to stand. With a Meridian cuirass, hold to climb and add Sprint for level flight."),KeyC:b(0,"Crouch","Press again to stand."),KeyX:b(0,"Prone","Press again to stand."),
  Mouse0:b(1,"Attack","Hold to use the equipped weapon. While building, place the preview."),Mouse2:b(1,"Aim / alternate attack"),MouseMove:b(0,"Look","Move the mouse to aim and steer the camera."),
  KeyR:b(1,"Reload"),KeyG:b(1,"Melee / lower bow"),KeyN:b(0,"Movement modifier","Used by movement and mount abilities."),
  KeyE:b(2,"Use / ride","Tap to interact, or to get in or out of a seat or saddle. Hold on a structure to open its actions."),KeyF:b(2,"Creature inventory","Opens the owned creature you are riding or looking at."),
  KeyI:b(2,"Inventory"),KeyP:b(2,"Character","Stats, engrams and crafting."),KeyM:b(2,"Map"),KeyL:b(2,"Minimap","Toggle visibility."),KeyH:b(2,"Inspect HUD","Hold for values and minimap controls. Release to return to play."),
  Minus:b(2,"Zoom out","Zoom the open map, or the minimap during play."),Equal:b(2,"Zoom in","Zoom the open map, or the minimap during play."),
  KeyV:b(2,"View","Switch first / third person when the server allows it."),KeyO:b(2,"Settings"),Escape:b(5,"Back / menu","Close one layer at a time."),Tab:b(2,"Console"),Slash:b(2,"Tribe chat"),Backquote:b(2,"Console"),Enter:b(2,"Chat"),KeyB:b(2,"Voice","Hold to talk, or use the toggle preference in Audio."),
  KeyT:b(2,"Follow: one","Whistle to the creature you are looking at."),KeyY:b(2,"Stay: one","Whistle to the creature you are looking at."),KeyJ:b(2,"Follow: all"),KeyU:b(2,"Stay: all"),
  Period:b(2,"Attack this target","Orders tribe creatures that can hear you."),BracketRight:b(2,"Attack my target"),
  KeyQ:b(3,"Next snap point","Tap to cycle snaps. Hold to toggle free placement."),
  ArrowUp:b(2,"Pan map up"),ArrowDown:b(2,"Pan map down"),ArrowLeft:b(2,"Pan map left"),ArrowRight:b(2,"Pan map right"),
};
const BUILD: Readonly<Record<string,Binding>>={KeyQ:b(3,"Next snap point","Tap to cycle snaps. Hold to toggle free placement."),KeyE:b(3,"Rotate","Rotate the active building preview."),KeyR:b(3,"Next variant","Cycle the active building piece variants."),ArrowUp:b(3,"Raise preview"),ArrowDown:b(3,"Lower preview"),Mouse0:b(3,"Place")};
const FLIGHT: Readonly<Record<string,Binding>>={Space:b(4,"Take off / land","A press toggles the flying mount's wing state."),KeyC:b(4,"Roll","Hold while riding a flyer."),KeyX:b(4,"Brake","Hold while riding a flyer."),KeyN:b(4,"Flight modifier"),ShiftLeft:b(4,"Fast flight","Hold while moving."),KeyE:b(4,"Dismount")};
const MENUS: Readonly<Record<string,Binding>>={Tab:b(5,"Next control","Shift + Tab moves backward."),Enter:b(5,"Select"),Space:b(5,"Select"),ArrowUp:b(5,"Previous control"),ArrowDown:b(5,"Next control"),ArrowLeft:b(5,"Decrease / previous"),ArrowRight:b(5,"Increase / next"),Escape:b(5,"Back","Close one layer at a time.")};
const HOTBAR=Array.from({length:10},(_,i)=>b(2,`Hotbar ${i}`,"Select this slot; press again to put it away."));
export function keyBinding(code:string,group:number):Binding|undefined {
  if(group===3 && BUILD[code])return BUILD[code];
  if(group===4 && FLIGHT[code])return FLIGHT[code];
  if(group===5)return MENUS[code];
  if(/^Digit[0-9]$/.test(code))return HOTBAR[Number(code.slice(-1))];
  return KEYS[code];
}
const PAD_MENU:Readonly<Record<number,Binding>>={0:b(5,"Select / drag","Hold to pick up an inventory stack; release over its destination."),1:b(5,"Back"),9:b(5,"Menu / back"),12:b(5,"Previous control"),13:b(5,"Next control"),14:b(5,"Decrease / previous"),15:b(5,"Increase / next"),10:b(5,"Navigate","Left stick: move focus. Horizontal movement adjusts the focused slider.")};
const PAD_DEFAULT:Readonly<Record<number,Binding>>={0:b(0,"Jump"),1:b(2,"Inventory","Hold LB / L1 first for the orbit camera."),2:b(1,"Reload","Tap to reload. Hold to open the owned creature's inventory."),3:b(2,"Use / ride","Tap to interact, or to get in or out of a seat or saddle. Hold on a structure to open its actions."),
    4:b(2,"Hotbar modifier","Hold with the D-pad for slots 5–8; with X / □ for 9; with Y / △ for 0. With RB / R1, switch view; with B / ○, the orbit camera."),5:b(1,"Melee / lower bow"),6:b(1,"Aim / alternate attack"),7:b(1,"Attack"),
    8:b(2,"Map / inspect","Tap to open the map. Hold to inspect the HUD; release to return to play."),9:b(5,"Menu"),10:b(0,"Move / sprint","Move with the left stick. Hold its button to sprint."),11:b(0,"Look / crouch / prone","Look with the right stick. On foot, tap to crouch or hold to go prone. At the wheel of a patrol vehicle, press it to change the lights."),
    12:b(2,"Hotbar 1 / 5","Hold LB / L1 for slot 5."),15:b(2,"Hotbar 2 / 6","Hold LB / L1 for slot 6."),13:b(2,"Hotbar 3 / 7","Hold LB / L1 for slot 7."),14:b(2,"Hotbar 4 / 8","Hold LB / L1 for slot 8.") };
const PAD_FLIGHT:Readonly<Record<number,Binding>>={11:b(4,"Look / roll / brake","Look with the right stick. Hold its button to roll; hold LB / L1 first to brake."),0:b(4,"Take off / land")};
const PAD_BUILD:Readonly<Record<number,Binding>>={7:b(3,"Place preview"),3:b(3,"Rotate preview"),2:b(3,"Next variant","Tap to cycle the building piece variants.")};
export function padBinding(button:number,group:number):Binding|undefined {
  if(group===5)return PAD_MENU[button];
  return (group===4?PAD_FLIGHT[button]:group===3?PAD_BUILD[button]:undefined)??PAD_DEFAULT[button];
}
