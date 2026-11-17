// Changes only after an explicitly authorized operational reset.
export const dataGeneration=db=>db.prepare('SELECT generation FROM data_generation WHERE id=1').get().generation;
export function requireGeneration(db,value){
 const current=dataGeneration(db);
 if(current!=='initial'&&value!==current)throw Object.assign(new Error('La base fue reiniciada. Actualiza la app e inicia sesión nuevamente.'),{status:409});
}
