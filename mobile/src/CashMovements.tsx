import React from 'react';
import {Text,View} from 'react-native';
import {InfoRow,cop,date,styles} from './ui';
export function CashMovements({value}:{value:any}){
 const collections=value.collection_details||[],expenses=value.expense_details||[];
 return <View style={{gap:10}}>
  <Text style={styles.h2}>Clientes que hicieron abonos</Text>
  {collections.length?collections.map((c:any)=><View key={c.id} style={{gap:2}}><InfoRow label={c.customer_name} value={cop(c.amount_cents)} strong/><Text style={styles.small}>{c.method==='cash'?'Efectivo':'Electrónico'} · Recibió: {c.user_name} · {date(c.created_at)}</Text></View>):<Text style={styles.small}>{value.collection_details?'Sin abonos en esta caja.':'Este cierre anterior no incluye detalle de clientes.'}</Text>}
  <Text style={styles.h2}>Gastos en efectivo</Text>
  {expenses.map((e:any)=><View key={e.id} style={{gap:2}}><InfoRow label={e.description} value={cop(e.amount_cents)}/><Text style={styles.small}>{e.user_name} · {date(e.created_at)}</Text></View>)}
  <InfoRow label="Total gastos" value={cop(value.expense_cents||0)} strong/>
 </View>;
}
