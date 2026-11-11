import {businessName} from './printing/number';
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {cop, quantityLabel, receiptNumber, saleNumber, shortDate, time} from './format';
import type {Sale} from './types';

// Logo de Dok Pollo MC; el controlador térmico lo convierte a blanco y negro.
const PRINT_LOGO = require('../assets/brand/dok-pollo-mc.png');

/**
 * Vista previa del ticket térmico. Usa solo los datos guardados de la venta (instantánea, precios y subtotales
 * históricos); jamás los precios actuales del catálogo. Refleja el diseño de server/src/pdf.js.
 */
export function Receipt({sale, width}: {sale: Sale; width: 58 | 80}) {
  const s = sale.snapshot;
  const paper = width === 58 ? 248 : 330;
  const size = width === 58 ? 11.5 : 13;
  const place = [s.business_address, s.business_city].filter(Boolean).join(' · ');
  const brand = businessName(s.business_name);
  const T = ({children, bold, center, big, small}: {children: React.ReactNode; bold?: boolean; center?: boolean; big?: boolean; small?: boolean}) =>
    <Text style={{fontSize: big ? size + 6 : small ? size - 2 : size, fontWeight: bold ? '700' : '400', textAlign: center ? 'center' : 'left', color: '#111', lineHeight: (big ? size + 6 : small ? size - 2 : size) * 1.35}}>{children}</Text>;
  const Pair = ({left, right, bold, big}: {left: string; right: string; bold?: boolean; big?: boolean}) =>
    <View style={r.pair}><Text style={{fontSize: big ? size + 4 : size, fontWeight: bold ? '800' : '400', color: '#111'}}>{left}</Text><Text style={{flexShrink: 1, textAlign: 'right', fontSize: big ? size + 4 : size, fontWeight: '700', color: '#111', fontVariant: ['tabular-nums']}}>{right}</Text></View>;
  return <View testID="receipt-preview" accessibilityLabel={`Comprobante venta ${saleNumber(sale)}`} style={[r.paper, {width: paper}]}>
    <Image source={PRINT_LOGO} resizeMode="contain" accessibilityLabel="Logo DOK POLLO MC" style={{width: paper * 0.48, height: paper * 0.48, alignSelf: 'center'}}/>
    <T bold center>{brand}</T>
    {!!s.business_nit && <T center small>NIT {s.business_nit}</T>}
    {!!place && <T center small>{place}</T>}
    {!!s.business_phone && <T center small>Tel. {s.business_phone}</T>}
    <View style={r.solid}/>
    <T center small bold>COMPROBANTE DE VENTA</T>
    <T center big bold>Venta {saleNumber(sale)}</T>
    <View style={r.solid}/>
    <Pair left="Fecha" right={shortDate(sale.created_at)}/>
    <Pair left="Hora" right={time(sale.created_at)}/>
    <Pair left="Vendedor" right={s.seller_name}/>
    {!!s.route_name&&<Pair left="Ruta" right={s.route_name}/>}
    {!!sale.session_number && <Pair left="Caja" right={`#${sale.session_number}`}/>}
    <View style={{height: 4}}/>
    <Pair left="Cliente" right={s.customer_name}/>
    <Pair left="Ciudad" right={s.customer_city}/>
    <View style={r.dash}/>
    <View style={r.pair}><T small bold>PRODUCTO</T><T small bold>VALOR</T></View>
    <View style={r.dash}/>
    {sale.items?.map(item => <View key={item.id} style={{marginBottom: 4}}>
      <T bold>{item.name.toUpperCase()}</T>
      <Pair left={`${quantityLabel(item.quantity_milli, item.unit)} × ${cop(item.price_cents)}${item.unit === 'kg' ? '/kg' : ''}`} right={cop(item.subtotal_cents)}/>
    </View>)}
    <View style={r.double}/>
    <Pair left="TOTAL" right={cop(sale.total_cents)} bold big/>
    <View style={r.double}/>
    {s.cash_received_cents!=null&&<><Pair left="Recibido" right={cop(s.cash_received_cents)}/><Pair left="Cambio" right={cop(s.cash_change_cents||0)}/></>}
    {s.credit&&<><Pair left="Abono inicial" right={cop(s.initial_paid_cents||0)}/><Pair left="Saldo al emitir" right={cop(s.initial_balance_cents||0)}/><T bold>{(s.initial_balance_cents||0)===0?'PAGADA':s.initial_paid_cents?'PAGO PARCIAL':'PENDIENTE'}</T></>}
    {sale.state==='ANULADA'&&<T bold>ANULADA · Original conservado</T>}
    <Pair left="Productos" right={String(sale.items?.length || 0)}/>
    {sale.payments?.map((p, i) => <View key={i}>
      <Pair left="Método de pago" right={p.method === 'cash' ? 'EFECTIVO' : (p.platform_name || 'ELECTRÓNICO').toUpperCase()}/>
      {p.method !== 'cash' && <Text style={{textAlign: 'right', fontSize: size - 2, color: '#111'}}>Pago electrónico</Text>}
    </View>)}
    <View style={r.dash}/>
    <T bold center>¡Gracias por comprar en {brand}!</T>
    <View style={{height: 4}}/>
    <T center small>Comprobante de venta.</T>
    <T center small>No es factura electrónica.</T>
  </View>;
}
const r = StyleSheet.create({
  paper: {backgroundColor: '#FFFFFF', alignSelf: 'center', maxWidth: '100%', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 22, gap: 2, borderRadius: 4,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: {width: 0, height: 4}, elevation: 4},
  pair: {flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap'},
  solid: {height: 1.5, backgroundColor: '#111', marginVertical: 6},
  double: {height: 5, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: '#111', marginVertical: 6},
  dash: {height: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#555', marginVertical: 6},
});
