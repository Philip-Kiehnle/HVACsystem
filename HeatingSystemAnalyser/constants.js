const rho_water = 998;  // kg/m³
const c_water = 4180;  // specific heat of water in J/(kg*K)
const mu = 0.001002;  // Pa·s

const d_radiator_pipe = 0.01;  // 10mm


// water volume in m³
const radiatorVolumeTable = {
  "Typ22_400x800": 0.0037,
  "Typ22_1800x500": 0.0081,
  "Typ22_600x1200": 0.0079,
  "Typ22_600x1600": 0.0106,
  "Typ22_600x2400": 0.0158,
  "Typ22_900x600": 0.0058,
  "Bagnotherm_1200x600": 0.0073,
  "Typ21_1800x500": 0.0081,
  "Typ11_900x600": 0.0029,
  "Typ11_900x800": 0.0038,
};

// todo fix values
//const radiatorFrictionTable = {
//  "Typ22_2400x600": 15,
//  "Typ22_1600x600": 12,
//  "Typ11_900x600": 8
//};
