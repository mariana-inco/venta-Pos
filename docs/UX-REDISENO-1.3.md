# Reorganización UX/UI — DOK POLLO MC 1.3.0

Cambios solo de presentación y navegación sobre el árbol de trabajo de `deploy/backend-pos`. No se modificaron el servidor, los contratos de la API, las validaciones del backend, los permisos ni el almacenamiento local. Todas las llamadas (`/deliveries`, `/inventory`, `/collections`, `/sales/:id/void`, `/route/close`, etc.) envían exactamente los mismos datos que antes.

## Diagnóstico

- **Navegación dispersa:** los módulos nuevos de 1.3 (cartera, rutas, inventario, cierre de ruta, resultados) solo se alcanzaban con dos iconos sin texto en la barra superior (tarjeta y mapa) o desde 8 accesos de Inicio, varios repetidos (Historial ya estaba abajo; Productos/Clientes duplicaban Catálogo; Inventario y Productos usaban el mismo icono).
- **Sin orientación:** al entrar a esos módulos ninguna pestaña inferior quedaba marcada y no había botón de regreso.
- **Pantallas saturadas:** Inventarios mostraba en una sola página la entrega, existencias, ajuste, grupos, historial de entregas y hasta 500 movimientos con códigos internos (`adjust`, `assign`) y cantidades sin unidad. Cuentas por cobrar apilaba la lista, el detalle de facturas y el estado de cuenta.
- **Estados mezclados:** el motivo del ajuste compartía el campo con las observaciones de la entrega; el grupo del ajuste con el de "Asociar producto"; el método del abono con el filtro de recaudos; las fechas del estado de cuenta con las de recaudos.
- **Selectores con aspecto de botón:** Ruta, Usuario o Cliente parecían botones de acción centrados.
- **Acción destructiva sin revisión:** la entrega diaria reemplaza todo el stock con un solo toque.

## Nueva estructura

Barra inferior: **Inicio · Caja · Vender · Historial · Más**. Barra superior: marca y sincronización, estado de caja y perfil.

**Más** agrupa todo por tarea, con una línea que explica cada módulo, filtrado por rol:

| Grupo | Administrador | Vendedor |
|---|---|---|
| Cobros | Cuentas por cobrar | Cuentas por cobrar |
| Rutas e inventario / Mi ruta · *nombre* | Inventarios y entregas, Cierre de ruta, Rutas | Inventario de mi ruta, Cierre de ruta, Rutas |
| Catálogo | Productos, Clientes | Productos, Clientes |
| Administración | Resultados y cierres | — |
| Cuenta | Perfil y configuración | Perfil y configuración |

Cada módulo abierto desde Más marca esa pestaña, tiene flecha de regreso y el botón atrás de Android vuelve a Más (y desde allí a Inicio). La visibilidad por rol es solo organizativa: el servidor sigue validando cada permiso.

## Pantallas

- **Inicio:** muestra la ruta junto a la fecha; avisa al vendedor sin ruta; 4 accesos rápidos según el rol con descripción, más "Ver todo".
- **Inventarios:** pestañas *Stock · Entrega · Ajuste · Grupos* (el vendedor solo ve Stock). Tarjetas con el disponible destacado; "Ajustar" desde cada tarjeta. El ajuste muestra el disponible actual y el cambio resultante. La entrega pasa por una revisión que lista cantidades y los inventarios que quedarán en cero; al confirmar se muestra el stock resultante. Historial plegable con tipos legibles (Entrega, Ajuste, Venta, Anulación), signo, unidad y paginación.
- **Cuentas por cobrar:** pestañas *Cartera · Abonar · Recaudos*. Total por cobrar, lista de deudores y detalle de cuenta con facturas y estado de cuenta. Atajos de fechas (Hoy, Este mes, Todo) y validación de formato. Anular y revertir explican su efecto y piden motivo.
- **Resultados y cierres:** pestañas *Jornada · Cierres de ruta*. Mosaico con vendido, crédito y recibido; detalle por vendedor, usuario, abonos e inventario.
- **Cierre de ruta:** explica qué hace el cierre antes del botón y muestra el estado de la jornada.
- **Rutas, Catálogo, Perfil:** encabezado con regreso; Rutas en lista con estado.
- **Componentes:** `ListRow` (fila navegable), `Header` con regreso y `SearchSelect` con aspecto de campo.

## Conservación de funciones

| Función | Antes | Ahora |
|---|---|---|
| Cartera, abono, recaudos, estado de cuenta y PDF, anular venta, revertir abono | Icono superior / Inicio | Más › Cuentas por cobrar (y acceso rápido en Inicio) |
| Entrega diaria con reintento seguro | Inventarios | Inventarios › Entrega |
| Existencias, entregas y movimientos | Inventarios | Inventarios › Stock |
| Ajuste autorizado | Inventarios | Inventarios › Ajuste o "Ajustar" en cada tarjeta |
| Crear grupo, asociar y retirar productos | Inventarios | Inventarios › Grupos |
| Crear, renombrar y consultar rutas con sus usuarios | Icono de mapa / Inicio | Más › Rutas |
| Cierre de ruta y cierres anteriores | Inicio | Más › Cierre de ruta (y Inicio) |
| Resultados por ruta, usuario y día; cierres históricos | Inicio (administrador) | Más › Resultados y cierres (y Inicio) |
| Productos y clientes | Pestaña Catálogo / Inicio | Más › Productos / Clientes (Clientes también en Inicio del vendedor) |
| Perfil, impresora, sincronización, usuarios, pagos, negocio, actividad, cerrar sesión | Avatar | Avatar o Más › Perfil y configuración |
| Vender, Caja, Historial | Barra inferior | Barra inferior (sin cambios) |

## Verificación

- `npm run check` (TypeScript): correcto.
- `npm test`: 25/25.
- `npm run test:e2e`: recorrido real actualizado a la nueva navegación (entrega con revisión, Más por rol, abono, PDF, resultados, cierre). Sin desbordes horizontales a 320, 390, 768 y 1280 px. Capturas en `output/screenshots/business/` (`inicio-*`, `mas-*`, `inventario-ajuste`, `cartera`, `resultados`).
- `scripts/e2e.mjs` (antiguo): se ajustó su acceso a Catálogo, pero falla antes de la interfaz porque crea un cliente sin ruta, que el backend 1.3 rechaza. Es previo a este trabajo.
- No probado en un equipo Android físico.
