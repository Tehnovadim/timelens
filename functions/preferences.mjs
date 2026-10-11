export function validPreferences(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!['en','ru'].includes(value.language)||!['light','dark'].includes(value.theme))return null;
 return {language:value.language,theme:value.theme};
}
