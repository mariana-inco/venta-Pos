import {offlineEnabled} from './offline/runtime';
import React from 'react';
import {Pressable, Text, View, useWindowDimensions} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {Banner, Button, IconButton, ListRow, Page, Section, Stat, capitalize, colors, cop, fitSize, longToday, radius, styles, time} from './ui';
import type {CashSession, Tab, User} from './types';
import type {Run} from '../App';
type Props = {user: User; route: {id: string; name: string} | null; sessions: CashSession[]; busy: boolean; run: Run; refresh: () => Promise<void>; go: (tab: Tab) => void; onHistory: () => void; onCatalog: (sub: 'products' | 'customers') => void};
export function HomeScreen({user, route, sessions, busy, run, refresh, go, onHistory, onCatalog}: Props) {
  const {width} = useWindowDimensions();
  const own = sessions.find(s => s.opened_by === user.id && s.state === 'open' && (offlineEnabled || !s.device_id));
  const admin = user.role === 'admin';
  // Administrador ve la suma de todas las cajas abiertas; vendedor, solo la suya.
  const scope = admin ? sessions.filter(s => s.state === 'open') : own ? [own] : [];
  const sum = (key: 'total_cents' | 'cash_cents' | 'electronic_cents' | 'sale_count') => scope.reduce((n, s) => n + s[key], 0);
  const count = sum('sale_count');
  // Solo las tareas frecuentes de cada rol; Historial ya está en la barra inferior y el resto en "Más".
  const shortcuts = admin ? [
    {name: 'Inventarios y entregas', hint: 'Entrega diaria y ajustes', icon: 'archive' as const, onPress: () => go('inventory')},
    {name: 'Resultados y cierres', hint: 'Ventas por ruta y vendedor', icon: 'bar-chart-2' as const, onPress: () => go('results')},
    {name: 'Cuentas por cobrar', hint: 'Deudas y abonos', icon: 'credit-card' as const, onPress: () => go('operations')},
    {name: 'Cierre de ruta', hint: 'Cerrar la jornada', icon: 'check-square' as const, onPress: () => go('routeclose')},
  ] : [
    {name: 'Cuentas por cobrar', hint: 'Registrar abonos', icon: 'credit-card' as const, onPress: () => go('operations')},
    {name: 'Inventario de mi ruta', hint: 'Existencias disponibles', icon: 'archive' as const, onPress: () => go('inventory')},
    {name: 'Clientes', hint: 'Consultar y crear', icon: 'users' as const, onPress: () => onCatalog('customers')},
    {name: 'Cierre de ruta', hint: 'Al terminar el recorrido', icon: 'check-square' as const, onPress: () => go('routeclose')},
  ];
  return <Page onRefresh={() => run(refresh)} refreshing={false}>
    <View style={[styles.row, {gap: 8}]}>
      <View style={{flex: 1, minWidth: 0}}>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.h2, {fontSize: 18}]}>Hola, {user.name.split(' ')[0]}</Text>
        <Text numberOfLines={1} style={styles.small}>{capitalize(longToday())}{route ? ` · ${route.name}` : ''}</Text>
      </View>
      <IconButton icon="refresh-cw" label="Actualizar resumen" onPress={() => run(refresh, 'Resumen actualizado')} disabled={busy} testID="refresh-home"/>
    </View>

    {!admin && !route && <Banner tone="orange" title="No tienes una ruta asignada" text="Tus clientes, inventario y cierre dependen de la ruta. Pide al administrador que te asigne una."/>}

    {own
      ? <View testID="cash-open-card" style={{gap: 10}}>
          <Button title="Nueva venta" icon="plus" size="lg" onPress={() => go('sale')} testID="new-sale"/>
          <Pressable accessibilityRole="button" accessibilityLabel="Ver mi caja" onPress={() => go('cash')} style={({pressed}) => [local.strip, pressed && {backgroundColor: colors.subtle}]}>
            <Feather name="unlock" size={16} color={colors.greenDark}/>
            <Text numberOfLines={2} style={[styles.small, {flex: 1, color: colors.text}]}><Text style={{fontWeight: '700', color: colors.greenDark}}>Caja{own.number ? ` #${own.number}` : ''} abierta</Text> · desde {time(own.opened_at)} · base {cop(own.opening_cents)}</Text>
            <Feather name="chevron-right" size={18} color={colors.muted}/>
          </Pressable>
        </View>
      : <View testID="cash-closed-card" style={local.closed}>
          <View style={[styles.row, {justifyContent: 'flex-start', alignItems: 'flex-start', gap: 10}]}>
            <Feather name="lock" size={18} color={colors.orange} style={{marginTop: 2}}/>
            <View style={{flex: 1, gap: 2}}>
              <Text style={[styles.h2, {fontSize: 16}]}>Tu caja está cerrada</Text>
              <Text style={styles.small}>Para vender, ábrela con el dinero base que tienes para dar cambio.</Text>
            </View>
          </View>
          <Button title="Abrir mi caja" icon="unlock" size="lg" onPress={() => go('cash')} testID="open-cash-home"/>
        </View>}

    <Section title={admin ? `Jornada · ${scope.length} ${scope.length === 1 ? 'caja abierta' : 'cajas abiertas'}` : 'Mi jornada'} action="Ver ventas" onAction={onHistory}>
      <View testID="stat-total" style={local.total}>
        <View style={[styles.row, {alignItems: 'flex-end'}]}>
          <View style={{flex: 1, minWidth: 0}}>
            <Text style={styles.small}>Total vendido</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.metric, {fontSize: fitSize(cop(sum('total_cents')), 30, 11)}]}>{cop(sum('total_cents'))}</Text>
          </View>
          <View style={local.count}><Text style={[styles.money, {fontSize: 16}]}>{count}</Text><Text style={styles.small}>{count === 1 ? 'venta' : 'ventas'}</Text></View>
        </View>
        <View style={[styles.wrap, {gap: 8}]}>
          <Stat label="Efectivo" value={cop(sum('cash_cents'))} icon="dollar-sign" tone="green"/>
          <Stat label="Electrónico" value={cop(sum('electronic_cents'))} icon="smartphone" tone="accent"/>
        </View>
      </View>
      {scope.length === 0 && <Text style={styles.small}>Los valores aparecen cuando hay una caja abierta.</Text>}
    </Section>

    <Section title="Accesos rápidos" action="Ver todo" onAction={() => go('more')}>
      <View style={[styles.wrap, {gap: 8}]}>
        {shortcuts.map(s => <View key={s.name} style={{flexGrow: 1, flexBasis: width >= 600 ? '45%' : '100%'}}>
          <ListRow icon={s.icon} tone="accent" title={s.name} subtitle={s.hint} onPress={s.onPress}/>
        </View>)}
      </View>
    </Section>
  </Page>;
}
const local = {
  strip: {flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line},
  closed: {gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderLeftColor: colors.orange},
  total: {gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line},
  count: {alignItems: 'flex-end' as const, paddingLeft: 8},
};
