import React from 'react';
import {View} from 'react-native';
import {Header, ListRow, Page, Section} from './ui';
import type {Tab, User} from './types';
type Icon = React.ComponentProps<typeof ListRow>['icon'];
type Item = {id: string; icon: Icon; title: string; subtitle: string; onPress: () => void};
type Props = {user: User; route: {id: string; name: string} | null; go: (tab: Tab) => void; onCatalog: (sub: 'products' | 'customers') => void};

/**
 * "Más": todos los módulos en un solo lugar, agrupados por tarea y con una línea que explica para qué sirven.
 * Solo organiza accesos; los permisos reales los valida el servidor.
 */
export function MenuScreen({user, route, go, onCatalog}: Props) {
  const admin = user.role === 'admin';
  const groups: {title: string; items: Item[]}[] = [
    {title: 'Cobros', items: [
      {id: 'operations', icon: 'credit-card', title: 'Cuentas por cobrar', subtitle: 'Clientes con deuda, abonos y estados de cuenta', onPress: () => go('operations')},
    ]},
    {title: admin ? 'Rutas e inventario' : route ? `Mi ruta · ${route.name}` : 'Mi ruta', items: [
      {id: 'inventory', icon: 'archive', title: admin ? 'Inventarios y entregas' : 'Inventario de mi ruta', subtitle: admin ? 'Entrega diaria, existencias, ajustes y grupos' : 'Existencias disponibles y entregas recibidas', onPress: () => go('inventory')},
      {id: 'routeclose', icon: 'check-square', title: 'Cierre de ruta', subtitle: admin ? 'Cerrar la jornada y consultar cierres anteriores' : 'Cerrar la jornada al terminar el recorrido', onPress: () => go('routeclose')},
      {id: 'routes', icon: 'map', title: 'Rutas', subtitle: admin ? 'Crear, renombrar y ver usuarios asignados' : 'Consultar tu ruta asignada', onPress: () => go('routes')},
    ]},
    {title: 'Catálogo', items: [
      {id: 'products', icon: 'tag', title: 'Productos', subtitle: admin ? 'Precios, códigos y existencias' : 'Precios y códigos', onPress: () => onCatalog('products')},
      {id: 'customers', icon: 'users', title: 'Clientes', subtitle: 'Datos, tipo de cliente y ruta', onPress: () => onCatalog('customers')},
    ]},
    ...(admin ? [{title: 'Administración', items: [
      {id: 'results', icon: 'bar-chart-2' as Icon, title: 'Resultados y cierres', subtitle: 'Ventas por ruta, usuario y vendedor; cierres históricos', onPress: () => go('results')},
    ]}] : []),
    {title: 'Cuenta', items: [
      {id: 'settings', icon: 'settings', title: 'Perfil y configuración', subtitle: admin ? 'Impresora, sincronización, usuarios, pagos y negocio' : 'Impresora, sincronización y cerrar sesión', onPress: () => go('settings')},
    ]},
  ];
  return <Page>
    <Header title="Más" subtitle="Todas las funciones, organizadas por tarea"/>
    {groups.map(g => <Section key={g.title} title={g.title}>
      <View style={{gap: 8}}>{g.items.map(i => <ListRow key={i.id} testID={`menu-${i.id}`} icon={i.icon} title={i.title} subtitle={i.subtitle} onPress={i.onPress}/>)}</View>
    </Section>)}
  </Page>;
}
