import JSConfetti from 'js-confetti';

const jsConfetti = new JSConfetti();

const TONE_EMOJIS = {
  // 😊 Amable: Buena onda, dulce, comida rica
  amable: ['😊', '🥰', '🍕', '🍰', '✨', '🍩', '👋'], 
  
  // 😏 Soberbio: "Yo sé más que vos", lujo, vino, fine dining
  soberbio: ['😏', '🧐', '🍷', '🦞', '💅', '🥩', '👑'], 
  
  // 😎 Irónico: Sarcasmo, lentes, birra, comida al paso, payaso
  ironico: ['😎', '🙄', '🍺', '🍟', '🤡', '👻', '🍕'] 
};

export const lanzarLluviaTono = (tono) => {
  // Normalizamos el string por las dudas (lowercase)
  const key = tono.toLowerCase();
  
  // Si no encuentra el tono, usa 'amable' por defecto
  const emojis = TONE_EMOJIS[key] || TONE_EMOJIS['amable'];

  jsConfetti.addConfetti({
    emojis: emojis,
    emojiSize: 40,       // Un poco más grandes para que se vean bien las expresiones
    confettiNumber: 10,  // Cantidad justa para no tapar la pantalla
  });
};