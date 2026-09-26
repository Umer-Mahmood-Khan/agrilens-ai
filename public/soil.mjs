// Display only explicit laboratory ratings; never infer status from a number.
export function labRating(reading) {
  const text = reading.interpretation.trim().toLowerCase();
  const match = /^(very low|low|deficient|medium|moderate|adequate|sufficient|normal|high|very high)(?:\.|,? as stated in (?:the )?(?:fictional |sample )?report)?$/.exec(text);
  if (!match) return 'Unrated';
  const rating = match[1];
  if (['very low', 'low', 'deficient'].includes(rating)) return 'Low';
  if (['medium', 'moderate'].includes(rating)) return 'Medium';
  if (['adequate', 'sufficient', 'normal'].includes(rating)) return 'Adequate';
  return 'High';
}

export function phValue(reading) {
  if (!/^pH(?:\s*\([^)]*\))?$/i.test(reading.parameter.trim())) return null;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(reading.value.trim())) return null;
  const value = Number(reading.value);
  return value >= 0 && value <= 14 ? value : null;
}
