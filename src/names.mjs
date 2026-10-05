// Capitalizes each word of a person's name as it is encoded: "juan DELA cruz" → "Juan Dela Cruz".
// Hyphenated and apostrophe parts are capitalized too (Anne-Marie, O'Brien); Roman numeral suffixes stay upper case
// (III), and "Jr." / "Sr." keep their usual form.
const ROMAN = /^(i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
const word = w => {
  if (!w) return w;
  if (ROMAN.test(w.replace(/\.$/, ''))) return w.toUpperCase();
  return w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
};
export function titleCase(value) {
  if (typeof value !== 'string') return value;
  return value.trim().split(/\s+/).filter(Boolean).map(word).join(' ');
}
const NAME_KEYS = ['firstName', 'middleName', 'lastName', 'suffix', 'preferredName'];
// Applies titleCase to the name fields of a personal-information object.
export function personalNames(personal) {
  if (!personal) return personal;
  return { ...personal, ...Object.fromEntries(NAME_KEYS.filter(k => typeof personal[k] === 'string').map(k => [k, titleCase(personal[k])])) };
}
// Name fields of each profile section that holds people's names.
export function sectionNames(section, value) {
  if (!value) return value;
  if (section === 'personal') return personalNames(value);
  if (section === 'emergency') return { ...value, name: titleCase(value.name) };
  if (section === 'family') {
    const person = p => (p ? { ...p, name: titleCase(p.name) } : p);
    return { ...value, spouse: person(value.spouse), father: person(value.father), mother: person(value.mother), children: (value.children || []).map(person) };
  }
  return value;
}
