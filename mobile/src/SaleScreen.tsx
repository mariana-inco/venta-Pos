import {offlineEnabled} from './offline/runtime';
import {useSyncStatus} from './DeviceSettings';
import {SearchSelect} from './SearchSelect';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Platform, Pressable, Text, View, TextInput, Switch} from 'react-native';
import {Feather} from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import {api, ApiError, documentAction, readPending, savePending} from './api';
import {Badge, Banner, Button, Card, Choice, Confirm, Empty, Field, FooterBar, IconButton, Loading, Page, SearchBar, Segmented, Sheet, Stepper, colors, cop, fitSize, lineSubtotal, moneyToCents, normalizeSearch, parseQuantity, quantityForApi, quantityLabel, quantityText, receiptNumber, saleNumber, styles, unitLabel, useBack} from './ui';
import type {Agent, CashSession, Product, Customer, Platform as PayPlatform, CartLine, Sale} from './types';
import {enableScanner,onBarcode} from './scanner';
import type {Run} from '../App';
type Props = {route?:{id:string;name:string}|null;userId: string; active: boolean; session?: CashSession; products: Product[]; customers: Customer[]; platforms: PayPlatform[]; paperWidth: 58 | 80; refresh: () => Promise<void>; run: Run; busy: boolean; onViewSale: (sale: Sale) => void; onOpenCash: () => void; onFlowChange?: (paying: boolean) => void};
type SaleView = 'catalog' | 'cart' | 'pay';
const KG_PRESETS = ['0,25', '0,5', '1', '1,5', '2', '3'];
const UNIT_PRESETS = ['1', '2', '3', '6', '12', '24'];
const PAGE = 30;

export function SaleScreen({route,userId, active, session, products:rawProducts, customers, platforms, paperWidth, refresh, run, busy, onViewSale, onOpenCash, onFlowChange}: Props) {
  const sync=useSyncStatus();
  const offlineReady=!!sync?.offline_ready;
  const [cart, setCart] = useState<CartLine[]>([]), [query, setQuery] = useState(''), [limit, setLimit] = useState(PAGE), [view, setView] = useState<SaleView>('catalog');
  const [customer, setCustomer] = useState(''), [pickCustomer, setPickCustomer] = useState(false), [customerSearch, setCustomerSearch] = useState(''), [newCustomer, setNewCustomer] = useState(false), [name, setName] = useState(''), [city, setCity] = useState('');
  const [draft,setDraft]=useState<any>(null),[hasInitial,setHasInitial]=useState(false),[initialMethod,setInitialMethod]=useState('cash'),[reference,setReference]=useState(''),[mixed,setMixed]=useState<{method:string;amount:string;reference:string}[]>([{method:'cash',amount:'',reference:''}]),[referenceErrors,setReferenceErrors]=useState<string[]>([]),[checkedRefs,setCheckedRefs]=useState('');
  const [agents,setAgents]=useState<Agent[]>([]),[agent,setAgent]=useState(''),[newType,setNewType]=useState('normal');
  useEffect(()=>{if(active)run(async()=>setAgents(await api<Agent[]>('/agents')));},[active,userId]);
  const customerType=customers.find(c=>c.id===customer)?.customer_type||'normal';
  const products=useMemo(()=>rawProducts.filter(p=>p.active&&p.stock_milli!==null&&p.stock_milli>0).map(p=>({...p,price_cents:draft?(draft.prices[p.id]?.price_cents||0):customerType==='wholesale'?p.wholesale_price_cents||0:p.price_cents})),[rawProducts,customerType,draft]);
  const [editing, setEditing] = useState<Product | null>(null), [qtyText, setQtyText] = useState('');
  const [pay, setPay] = useState(''), [received, setReceived] = useState('');
  const [ready, setReady] = useState(false), [pending, setPending] = useState<Record<string, unknown> | null>(null), [done, setDone] = useState<{sale: Sale; change: number | null} | null>(null);
  // Bloqueo síncrono: un doble toque no alcanza a crear dos ventas aunque React aún no haya deshabilitado el botón.
  const confirming = useRef(false),startingDraft=useRef(false);
  const [scanMessage,setScanMessage]=useState('');
  useEffect(()=>{void enableScanner(active).catch(e=>setScanMessage(e.message));return ()=>{void enableScanner(false).catch(()=>{});};},[active]);
  useEffect(()=>{const subscription=onBarcode(code=>{if(!active)return;if(editing||pickCustomer||view==='pay'||done||pending){setScanMessage('Confirma o cierra el formulario actual antes de escanear el siguiente producto.');return;}const p=products.find(p=>p.active&&p.codes?.some(c=>c.code.toLowerCase()===code.trim().toLowerCase()));if(p){setScanMessage('');setView('catalog');openQuantity(p);}else{setQuery(code);setScanMessage(`No hay un producto con el código ${code}.`);}});return ()=>subscription?.remove();},[active,editing,pickCustomer,view,done,pending,products,cart,agent,customer]);
  const searchInput=useRef<React.ComponentRef<typeof TextInput>>(null);
  const [credit,setCredit]=useState(false),[initialPayment,setInitialPayment]=useState(''),[clearCart,setClearCart]=useState(false);
  useEffect(()=>{if(active&&view==='catalog'&&!editing&&!pickCustomer&&!done){const timer=setTimeout(()=>searchInput.current?.focus(),350);return ()=>clearTimeout(timer);}},[active,view,editing,pickCustomer,done]);
  useEffect(() => { run(async () => { setPending(await readPending(userId)); setReady(true); }); }, [userId]);
  // Al actualizar el catálogo, el carrito toma precios y existencias vigentes (la API rechaza precios desactualizados).
  useEffect(() => { setCart(lines => lines.map(l => ({...l, product: products.find(p => p.id === l.product.id) || l.product}))); }, [products]);
  // En web, advertir antes de cerrar o recargar con una venta sin terminar.
  useEffect(() => {
    if (Platform.OS !== 'web' || cart.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [cart.length]);
  useBack(active && view !== 'catalog' && !done, () => setView('catalog'));
  // Durante el cobro la navegación inferior se oculta; Atrás y "Seguir agregando" vuelven a la venta sin perder nada.
  useEffect(() => { onFlowChange?.(view === 'pay' && !done && !pending && !!session); }, [view, done, pending, session]);

  const selectedCustomer = customers.find(c => c.id === customer);
  const lines = cart.map(l => {
    const milli = parseQuantity(l.quantity, l.product.unit);
    const groupTotal=cart.filter(c=>l.product.group_id?c.product.group_id===l.product.group_id:c.product.id===l.product.id).reduce((n,c)=>n+(parseQuantity(c.quantity,c.product.unit)||0),0);
    const short = milli !== null && l.product.stock_milli !== null && groupTotal > l.product.stock_milli;
    return {...l, milli, short:short||l.product.price_cents<=0||!products.some(p=>p.id===l.product.id), subtotal: milli ? lineSubtotal(l.product.price_cents, milli) : 0};
  });
  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  const linesOk = lines.length > 0 && lines.every(l => l.milli !== null && !l.short);
  const method = pay==='mixed'?'mixed':pay === 'credit'?'credit':pay === 'cash' ? 'cash' : pay ? 'electronic' : '';
  const receivedCents = received.trim() ? moneyToCents(received) : null;
  const receivedError = method === 'cash' && received.trim() ? (receivedCents === null ? 'Escribe un valor válido, por ejemplo 50.000' : receivedCents < total ? `Faltan ${cop(total - receivedCents)}` : null) : null;
  const initialCents=hasInitial?(initialPayment.trim()?moneyToCents(initialPayment):null):0;
  const mixedEntered=mixed.reduce((n,p)=>n+(moneyToCents(p.amount)||0),0);
  const refs=method==='mixed'?mixed.filter(p=>p.method!=='cash').map(p=>({platform_id:p.method,reference:p.reference})):method==='electronic'?[{platform_id:pay,reference}]:method==='credit'&&hasInitial&&initialMethod!=='cash'?[{platform_id:initialMethod,reference}]:[];
  const refsKey=JSON.stringify(refs);
  useEffect(()=>{if(offlineReady&&refs.length){setReferenceErrors(['Finaliza el modo sin internet para verificar pagos electrónicos.']);setCheckedRefs(refsKey);return;}if(!refs.length){setReferenceErrors([]);setCheckedRefs(refsKey);return;}let live=true;const timer=setTimeout(()=>{Promise.all(refs.map(async p=>{if(!p.reference.trim())return 'Ingresa la referencia de cada pago electrónico.';const r=await api<{duplicate:boolean}>('/payment-reference?'+new URLSearchParams(p));return r.duplicate?'Referencia ya registrada para este medio.':'';})).then(raw=>{const errors:string[]=raw;if(live){const keys=refs.map(p=>p.platform_id+'/'+p.reference.normalize('NFKC').replace(/\s/g,'').toUpperCase());if(new Set(keys).size<keys.length)errors.push('Hay referencias repetidas en las líneas de pago.');setReferenceErrors(errors.filter(Boolean));setCheckedRefs(refsKey);}}).catch(()=>{if(live){setReferenceErrors(['No se pudo verificar la referencia. Revisa la conexión.']);setCheckedRefs(refsKey);}});return ()=>{live=false;};},250);return ()=>{live=false;clearTimeout(timer);};},[refsKey,offlineReady]);
  const referencesOk=(!offlineReady||!refs.length)&&(!refs.length||(refs.every(p=>p.reference.trim())&&checkedRefs===refsKey&&!referenceErrors.length));

  const valid = (!offlineReady||method==='cash'||(method==='credit'&&(!hasInitial||initialMethod==='cash'))) && !!draft && referencesOk && (method!=='mixed'||(mixedEntered===total&&mixed.every(p=>(moneyToCents(p.amount)||0)>0))) && (method!=='credit'||(initialCents!==null&&initialCents>=0&&initialCents<=total&&(!hasInitial||initialCents>0))) && !!route && !!agent && !!session && !!customer && linesOk && !!method && (method==='credit'||!receivedError);
  const inCart = (id: string) => lines.find(l => l.product.id === id);

  const visible = useMemo(() => {
    const q = normalizeSearch(query);
    if(!q||!draft||!agent||!customer)return [];
    const exact=products.filter(p=>p.active&&p.codes?.some(c=>normalizeSearch(c.code)===q));if(exact.length)return exact;
    return products.filter(p => p.active && (normalizeSearch(p.name).includes(q)||p.codes?.some(c=>normalizeSearch(c.code).includes(q))));
  }, [products, query,agent,customer]);
  const customerMatches = useMemo(() => {
    const q = normalizeSearch(customerSearch);
    return customers.filter(c => (c.route_id===route?.id||c.routes?.some(r=>r.id===route?.id))&&(!q || normalizeSearch(c.name).includes(q) || normalizeSearch(c.city).includes(q))).slice(0, 40);
  }, [customers, customerSearch,route?.id]);

  function setLine(product: Product, quantity: string) {
    setCart(c => c.some(l => l.product.id === product.id) ? c.map(l => l.product.id === product.id ? {...l, quantity} : l) : [...c, {product, quantity}]);
  }
  const remove = (id: string) => setCart(c => c.filter(l => l.product.id !== id));
  function step(line: CartLine, direction: 1 | -1) {
    const unit = line.product.unit, delta = unit === 'kg' ? 250 : 1000;
    const current = parseQuantity(line.quantity, unit) || 0;
    setLine(line.product, quantityText(Math.max(delta, current + direction * delta)));
  }
  function quickAdd(product:Product){openQuantity(product);}
  function scan(){const code=query.trim().toLowerCase();const p=products.find(p=>p.active&&p.codes?.some(c=>c.code.toLowerCase()===code));if(p)openQuantity(p);}
  function openQuantity(product: Product) {
    if(!agent||!customer){setScanMessage('Selecciona primero vendedor y cliente.');return;}if(product.price_cents<=0){setScanMessage('Falta configurar el precio mayorista del producto.');return;}
    setEditing(product); setQtyText(product.unit === 'unit' ? '1' : '');
  }
  const editMilli = editing ? parseQuantity(qtyText, editing.unit) : null;
  const editShort = editing && editMilli !== null && editing.stock_milli !== null && editMilli + cart.filter(l=>editing.group_id?l.product.group_id===editing.group_id:l.product.id===editing.id).reduce((n,l)=>n+(parseQuantity(l.quantity,l.product.unit)||0),0)> editing.stock_milli;
  function saveQuantity() { if (editing && editMilli !== null && !editShort) { setLine(editing, quantityText(editMilli+(inCart(editing.id)?.milli||0))); setEditing(null);setQuery(''); } }

  async function chooseCustomer(id:string){if(startingDraft.current)return;if(draft)throw new Error('El cliente está fijo. Inicia una venta nueva para cambiarlo.');startingDraft.current=true;try{const d=await api<any>('/sale-drafts','POST',{customer_id:id,agent_id:agent,request_key:Crypto.randomUUID()});setDraft(d);setCustomer(id);setPickCustomer(false);}finally{startingDraft.current=false;}}
  function reset() {setDraft(null);setHasInitial(false);setReference('');setMixed([{method:'cash',amount:'',reference:''}]);setCredit(false);setInitialPayment(''); setCart([]); setPay(''); setReceived(''); setView('catalog'); setQuery(''); setCustomer(''); setLimit(PAGE); }
  async function confirm() {
    if (confirming.current) return;
    if (!valid && !pending) throw new Error('Completa el cliente, las cantidades y el método de pago antes de confirmar.');
    confirming.current = true;
    try {
      const body = pending || {draft_id:draft.id,agent_id:agent,cash_received:!credit&&method==='cash'&&receivedCents!==null?String(receivedCents/100):undefined,credit:method==='credit',initial_payment:method==='credit'&&hasInitial?String((initialCents||0)/100):undefined,initial_method:initialMethod==='cash'?'cash':'electronic',initial_platform_id:initialMethod!=='cash'?initialMethod:undefined,reference:refs.length&&method!=='mixed'?reference:undefined,payments:method==='mixed'?mixed.map(p=>({method:p.method==='cash'?'cash':'electronic',platform_id:p.method==='cash'?null:p.method,reference:p.method==='cash'?undefined:p.reference,amount:String((moneyToCents(p.amount)||0)/100)})):undefined,session_id: session!.id, customer_id: customer, items: lines.map(l => ({product_id: l.product.id, quantity: quantityForApi(l.milli!), expected_price_cents: l.product.price_cents})), method, platform_id: method === 'electronic' ? pay : null, request_key: draft.id};
      // La referencia se guarda antes de enviar: si se cae la conexión, el reintento no duplica la venta.
      await savePending(userId, body); setPending(body);
      let sale: Sale;
      try { sale = await api<Sale>('/sales', 'POST', body); }
      catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429) { await savePending(userId, null); setPending(null); if (e.status === 409) void refresh().catch(() => undefined); }
        throw e;
      }
      await savePending(userId, null); setPending(null);
      setDone({sale, change: method === 'cash' && receivedCents !== null ? receivedCents - sale.total_cents : null});
      reset(); await refresh();
    } finally { confirming.current = false; }
  }

  if (!ready) return <Page><Loading text="Recuperando ventas pendientes…"/></Page>;

  // ── Venta registrada
  if (done) {
    const {sale, change} = done, p = sale.payments?.[0];
    const local = sale.sync_status === 'pending';
    return <Page testID="sale-done">
      <View style={{alignItems: 'center', gap: 6, paddingTop: 8}}>
        <View style={{width: 60, height: 60, borderRadius: 30, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center'}}><Feather name="check" size={32} color={colors.greenDark}/></View>
        <Text accessibilityRole="header" style={styles.title}>Venta registrada</Text>
        <Text style={[styles.muted, {textAlign: 'center'}]}>Venta {saleNumber(sale)} · {sale.snapshot.customer_name}</Text>
      </View>
      <Card style={{gap: 8}}>
        <View style={styles.row}><Text style={styles.body}>Total</Text><Text testID="done-total" style={[styles.metric, {fontSize: fitSize(cop(sale.total_cents), 28, 10)}]}>{cop(sale.total_cents)}</Text></View>
        <View style={styles.row}><Text style={styles.body}>Pago</Text><Badge text={sale.snapshot.credit ? 'Crédito' : p?.method === 'cash' ? 'Efectivo' : p?.platform_name || 'Electrónico'} tone="gray"/></View>
        {sale.snapshot.credit && <View style={styles.row}><Text style={styles.body}>{sale.state}</Text><Text style={[styles.money, {fontSize: 16}]}>Saldo {cop(sale.balance_cents || 0)}</Text></View>}
        {change !== null && change > 0 && <View style={[styles.row, {backgroundColor: colors.yellowSoft, borderRadius: 10, padding: 10}]}><Text style={[styles.h2, {fontSize: 16}]}>Cambio a entregar</Text><Text style={[styles.metric, {fontSize: 22}]}>{cop(change)}</Text></View>}
      </Card>
      <View style={{gap: 6}}>
        <StatusRow ok text={local ? 'Guardada en este equipo' : 'Guardada en el servidor'}/>
        {local && <StatusRow text="Pendiente de sincronizar: se enviará automáticamente al haber conexión"/>}
      </View>
      {sale.pdf_message && <Banner tone="orange" text={sale.pdf_message}/>}
      <View style={{gap: 10}}>
        <View style={[styles.wrap, {gap: 10}]}>
          <Button title="Ver comprobante" icon="file-text" variant="outline" style={{flexGrow: 1, minWidth: 180}} onPress={() => { setDone(null); onViewSale(sale); }} testID="sale-view-receipt"/>
          <Button title="Compartir" icon="share-2" variant="outline" style={{flexGrow: 1, minWidth: 120}} disabled={busy} onPress={() => run(() => documentAction(`/sales/${sale.id}`, paperWidth, 'share'))}/>
        </View>
        <Text style={[styles.small, {textAlign: 'center'}]}>Si la impresora falla, reimprime desde aquí o desde Historial. No registres la venta otra vez.</Text>
        <Button title="Nueva venta" icon="plus" variant="secondary" size="lg" onPress={() => setDone(null)} testID="sale-new"/>
      </View>
    </Page>;
  }

  // ── Venta cuya confirmación quedó en el aire (sin conexión): solo se puede reintentar con la misma referencia.
  if (pending) return <Page>
    <Banner tone="orange" title="Hay una venta sin confirmar" text="Se perdió la conexión mientras se guardaba. No la registres otra vez: toca Reintentar y el sistema confirma o recupera la misma venta, sin duplicarla."/>
    <Card><Text style={styles.small}>Referencia: {String(pending.request_key)}</Text><Button title="Reintentar confirmación" icon="refresh-cw" size="lg" loading={busy} onPress={() => run(confirm, 'Venta confirmada')}/></Card>
  </Page>;

  if(!route)return <Page><Banner text="El administrador debe asignarte una ruta para vender."/></Page>;
  if (!session) return <Page><Empty icon="lock" title="Tu caja está cerrada" text="Para registrar ventas, primero abre tu caja con el dinero base. Las ventas anteriores siguen en el historial." action="Abrir mi caja" onAction={onOpenCash}/></Page>;

  const footer = view === 'pay'
    ? <FooterBar>
        <View style={{flex: 1, minWidth: 0}}><Text style={styles.small}>{cart.length} {cart.length === 1 ? 'producto' : 'productos'} · total</Text><Text numberOfLines={1} style={[styles.metric, {color: colors.ink, fontSize: fitSize(cop(total), 22, 9)}]}>{cop(total)}</Text></View>
        <Button title="Confirmar venta" icon="check" size="lg" style={{flexShrink: 1, paddingHorizontal: 16}} loading={busy} disabled={!valid} onPress={() => run(confirm, 'Venta registrada')} testID="confirm-sale"/>
      </FooterBar>
    : <FooterBar>
        <Pressable accessibilityRole="button" accessibilityLabel="Ver productos de la venta" onPress={() => setView('cart')} style={{flex: 1, minWidth: 0}}>
          <Text style={styles.small}>{cart.length === 0 ? 'Sin productos' : `${cart.length} ${cart.length === 1 ? 'producto' : 'productos'} · ver venta`}</Text>
          <Text testID="sale-total" numberOfLines={1} style={[styles.metric, {color: colors.ink, fontSize: fitSize(cop(total), 22, 9)}]}>{cop(total)}</Text>
        </Pressable>
        <Button title="Cobrar" icon="arrow-right" size="lg" style={{flexShrink: 1, paddingHorizontal: 20}} disabled={!agent||!customer||!linesOk} onPress={() => setView('pay')} testID="checkout"/>
      </FooterBar>;

  const customerCard = <Pressable accessibilityRole="button" accessibilityLabel={selectedCustomer ? `Cliente ${selectedCustomer.name}, fijo` : 'Seleccionar cliente'} disabled={!!draft} onPress={() => { setPickCustomer(true); setCustomerSearch(''); setNewCustomer(false); }} testID="customer-picker"
    style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: selectedCustomer ? colors.line : colors.lineStrong, borderStyle: selectedCustomer ? 'solid' : 'dashed'}, pressed && {backgroundColor: colors.subtle}]}>
    <Feather name="user" size={18} color={selectedCustomer ? colors.ink : colors.muted}/>
    <View style={{flex: 1, minWidth: 0}}>
      {selectedCustomer ? <Text numberOfLines={1} style={[styles.body, {color: colors.ink, fontWeight: '700'}]}>{selectedCustomer.name}<Text style={[styles.small, {fontWeight: '400'}]}> · {selectedCustomer.city}</Text></Text>
        : <Text style={[styles.body, {color: colors.text}]}>Cliente <Text style={styles.small}>· obligatorio</Text></Text>}
    </View>
    <Text style={styles.link}>{selectedCustomer ? 'Fijo' : 'Elegir'}</Text>
  </Pressable>;

  return <>
    <Page footer={footer} testID="sale-screen">
      {draft&&<Button title="Cancelar venta e iniciar otra" variant="ghost" onPress={()=>setClearCart(true)}/>}
      {!!scanMessage&&<Banner tone="orange" text={scanMessage} onClose={()=>setScanMessage('')}/>}
      {view === 'pay' ? <>
        <Pressable accessibilityRole="button" onPress={() => setView('catalog')} style={[styles.row, {justifyContent: 'flex-start', gap: 6, minHeight: 44}]} hitSlop={8}><Feather name="arrow-left" size={18} color={colors.accentDark}/><Text style={styles.link}>Seguir agregando productos</Text></Pressable>
        <View style={{gap: 2}}><Text style={styles.small}>Total a cobrar</Text><Text accessibilityRole="header" testID="pay-total" numberOfLines={1} style={[styles.metric, {fontSize: fitSize(cop(total), 32, 10)}]}>{cop(total)}</Text></View>
        {customerCard}

        {!customer && <View style={[styles.fieldErrorRow, {marginTop: -6}]}><Feather name="info" size={14} color={colors.orange}/><Text style={[styles.small, {color: colors.orange, flex: 1}]}>Elige el cliente para poder confirmar.</Text></View>}
        <Card>
          <View style={styles.row}><Text style={styles.sectionTitle}>Productos</Text><Pressable accessibilityRole="button" onPress={() => setView('cart')} hitSlop={12}><Text style={styles.link}>Editar</Text></Pressable></View>
          {lines.map(l => <View key={l.product.id} style={[styles.row, {alignItems: 'flex-start'}]}>
            <View style={{flex: 1}}><Text style={{color: colors.ink, fontWeight: '600', fontSize: 15}}>{l.product.name}</Text><Text style={styles.small}>{l.milli ? quantityLabel(l.milli, l.product.unit) : '—'} × {cop(l.product.price_cents)}{l.product.unit === 'kg' ? '/kg' : ''}</Text></View>
            <Text style={[styles.money, {fontSize: 15}]}>{cop(l.subtotal)}</Text>
          </View>)}
          <View style={styles.divider}/>
          <View style={styles.row}><Text style={styles.h2}>Total</Text><Text style={[styles.metric, {color: colors.ink}]}>{cop(total)}</Text></View>
        </Card>
        <Card>
          <Text style={styles.sectionTitle}>Método de pago</Text>
          {offlineReady&&<Text style={styles.small}>Modo sin internet: efectivo o crédito. Para pagos electrónicos, cancela esta venta y finaliza el modo con conexión.</Text>}
          <View style={[styles.wrap, {gap: 10}]}>
            {[{id:'mixed',name:'Varios',icon:'layers' as const},{id:'credit',name:'Crédito',icon:'clock' as const},{id: 'cash', name: 'Efectivo', icon: 'dollar-sign' as const}, ...platforms.filter(p => p.active).map(p => ({id: p.id, name: p.name, icon: 'smartphone' as const}))].filter(m=>!offlineReady||m.id==='cash'||m.id==='credit').map(m => {
              const on = pay === m.id;
              return <Pressable key={m.id} accessibilityRole="radio" accessibilityLabel={m.name} accessibilityState={{checked: on}} onPress={() => {setPay(m.id);setReference('');setCredit(m.id==='credit');}}
                style={[{flexGrow: 1, flexBasis: '45%', minHeight: 56, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: on ? colors.accent : colors.lineStrong, backgroundColor: on ? colors.accentSoft : colors.white, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12}]}>
                <Feather name={on ? 'check-circle' : m.icon} size={18} color={on ? colors.accentDark : colors.muted}/><Text numberOfLines={2} style={{flex: 1, fontWeight: '700', color: colors.ink, fontSize: 14}}>{m.name}</Text>
              </Pressable>;
            })}
          </View>
          {method==='credit'&&<><View style={styles.row}><Text style={styles.label}>Registrar abono inicial</Text><Switch accessibilityLabel="Registrar abono inicial" value={hasInitial} onValueChange={setHasInitial}/></View>{hasInitial&&<><Field label="Abono inicial" kind="decimal" value={initialPayment} onChange={setInitialPayment}/><SearchSelect label="Medio del abono inicial" items={[{id:'cash',name:'Efectivo'},...platforms.filter(p=>p.active&&!offlineReady)]} value={initialMethod} onChange={v=>{setInitialMethod(v);setReference('');}}/></>}<Text style={styles.h2}>Saldo pendiente: {cop(total-(initialCents||0))}</Text></>}
          {(method==='electronic'||(method==='credit'&&hasInitial&&initialMethod!=='cash'))&&<Field label="Referencia de pago" value={reference} onChange={setReference} required/>}
          {method==='mixed'&&<>{mixed.map((p,i)=><Card key={i}><SearchSelect label={`Medio de pago ${i+1}`} items={[{id:'cash',name:'Efectivo'},...platforms.filter(x=>x.active)]} value={p.method} onChange={v=>setMixed(mixed.map((x,j)=>i===j?{...x,method:v,reference:''}:x))}/><Field label={`Importe ${i+1}`} kind="decimal" value={p.amount} onChange={v=>setMixed(mixed.map((x,j)=>i===j?{...x,amount:v}:x))}/>{p.method!=='cash'&&<Field label={`Referencia de pago ${i+1}`} value={p.reference} onChange={v=>setMixed(mixed.map((x,j)=>i===j?{...x,reference:v}:x))} required/>}<Button title="Quitar pago" variant="ghost" onPress={()=>setMixed(mixed.filter((_,j)=>j!==i))}/></Card>)}<Button title="Agregar medio de pago" variant="outline" onPress={()=>setMixed([...mixed,{method:'cash',amount:'',reference:''}])}/><Text style={styles.body}>Total factura: {cop(total)}</Text><Text style={styles.body}>Total ingresado: {cop(mixedEntered)}</Text><Text style={mixedEntered===total?styles.h2:styles.fieldError}>{mixedEntered>total?'Excedente: ':'Pendiente: '}{cop(Math.abs(total-mixedEntered))}</Text></>}
          {referenceErrors.map((error,i)=><Text key={i} style={styles.fieldError}>{error}</Text>)}
          {method === 'cash' && !credit && <View style={{gap: 10}}>
            <Field label="Valor recibido (opcional)" kind="decimal" prefix="$" value={received} onChange={setReceived} placeholder={cop(total).replace('$', '').trim()} error={receivedError} hint="Escríbelo o toca un billete para calcular el cambio." testID="cash-received"/>
            <Choice items={cashSuggestions(total).map(v => ({id: String(v), name: v === total ? 'Exacto' : cop(v)}))} value={receivedCents !== null ? String(receivedCents) : ''} onChange={v => setReceived(String(Number(v) / 100))}/>
            {receivedCents !== null && !receivedError && <Card tone={receivedCents > total ? 'yellow' : 'green'} style={{paddingVertical: 12}}><View style={styles.row}><Text style={[styles.h2, {fontSize: 15}]}>Cambio a entregar</Text><Text testID="cash-change" style={[styles.metric, {color: colors.ink}]}>{cop(receivedCents - total)}</Text></View></Card>}
          </View>}
          {method === 'electronic' && <View style={styles.fieldErrorRow}><Feather name="info" size={14} color={colors.muted}/><Text style={[styles.small, {flex: 1}]}>Verifica que el pago aparezca en la cuenta antes de confirmar.</Text></View>}
          {!method && <Text style={styles.small}>Elige cómo paga el cliente.</Text>}
        </Card>
        <Text style={[styles.small, {textAlign: 'center'}]}>Al confirmar, el sistema verifica precios, existencias y caja, y genera el comprobante.</Text>
      </> : <>
        {route&&<View style={[styles.row, {justifyContent: 'flex-start', gap: 6}]}><Feather name="map-pin" size={14} color={colors.muted}/><Text numberOfLines={2} style={[styles.small, {flex: 1}]}>Ruta {route.name} · {offlineReady?'Ventas guardadas en la terminal y sincronización automática':'Confirma con conexión o prepara el modo sin internet'}</Text></View>}
        {offlineEnabled&&<View style={{gap:8}}>
          {offlineReady&&<Text style={styles.small}>Sin internet puedes vender en efectivo o a crédito con abono en efectivo. Los pagos electrónicos, abonos de cartera, gastos y cierres requieren conexión. Sincroniza y finaliza este modo antes de cambiar entregas o cerrar la ruta.</Text>}
          <Button title={offlineReady?'Sincronizar y finalizar modo sin internet':'Preparar ventas sin internet'} icon={offlineReady?'refresh-cw':'download'} variant="outline" disabled={busy||!!draft||cart.length>0} onPress={()=>run(async()=>{await api(offlineReady?'/offline-route/release':'/offline-route/prepare','POST',offlineReady?{}:{session_id:session!.id});await refresh();setAgents(await api<Agent[]>('/agents'));},offlineReady?'Ventas sincronizadas; inventario liberado':'Terminal lista para vender sin internet')}/>
          {!offlineReady&&<Text style={styles.small}>Con conexión y caja abierta, prepara el catálogo, clientes, vendedores y stock de tu ruta. Esa reserva será exclusiva de esta terminal hasta que finalices el modo.</Text>}
        </View>}
        <SearchSelect label="1. Vendedor" items={agents} value={agent} disabled={!!draft} onChange={id=>{setAgent(id);setCustomer('');}}/>
        {!agents.length&&<Banner text="El administrador debe asociar vendedores a tu usuario."/>}
        {!!agent&&customerCard}
        {!!customer&&<Text style={styles.hint}>Precio automático: {customerType==='wholesale'?'Mayorista':'Normal'}</Text>}
        <Segmented items={[{id: 'catalog', name: 'Productos'}, {id: 'cart', name: `En la venta${cart.length ? ` (${cart.length})` : ''}`}]} value={view} onChange={v => setView(v as SaleView)} testID="sale-tabs"/>
        {view === 'catalog' ? <>
          <View style={[styles.row, {gap: 8}]}>
            <View style={{flex: 1}}><SearchBar inputRef={searchInput} value={query} onChange={t=>{setQuery(t);setLimit(PAGE);}} onSubmit={scan} placeholder="Buscar producto o leer código" testID="product-search"/></View>
            <IconButton icon="refresh-cw" label="Actualizar precios y existencias" onPress={() => run(refresh, 'Precios actualizados')} disabled={busy}/>
          </View>
          {visible.length === 0 && (cart.length===0||!!query.trim()) && <Empty icon="search" title={!query?'Busca un producto':products.length?'Sin resultados':'Aún no hay productos'} text={!query?'Escribe parte del nombre o lee el código de barras.':`No encontramos “${query}”. Revisa la escritura o prueba con otra palabra.`}/>}
          <View style={{gap: 8}}>
            {visible.slice(0, limit).map(p => {
              const line = inCart(p.id), out = p.stock_milli === 0||p.price_cents<=0;
              return <Pressable key={p.id} testID={`product-${p.name}`} accessibilityRole="button" accessibilityLabel={`${p.name}, ${cop(p.price_cents)} por ${p.unit === 'kg' ? 'kilogramo' : 'unidad'}`} disabled={out} onPress={() => openQuantity(p)}
                style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 12, borderWidth: line ? 2 : 1, borderColor: line ? colors.accent : colors.line, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, minHeight: 64}, pressed && {backgroundColor: colors.subtle}, out && {opacity: 0.55}]}>
                <View style={{flex: 1, gap: 3}}>
                  <Text numberOfLines={2} style={{fontSize: 16, fontWeight: "700", color: colors.ink}}>{p.name}</Text>
                  <View style={[styles.row, {justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap'}]}>
                    <Text style={[styles.money, {fontSize: 15}]}>{p.price_cents?cop(p.price_cents):'Precio sin configurar'}<Text style={styles.small}> / {p.unit === 'kg' ? 'kg' : 'und'}</Text></Text>
                    {p.stock_milli !== null && <Text style={[styles.small, {color: out ? colors.red : p.stock_milli <= (p.unit === 'kg' ? 2000 : 5000) ? colors.orange : colors.muted}]}>{out ? 'Agotado' : `Quedan ${quantityLabel(p.stock_milli, p.unit)}`}</Text>}
                  </View>
                  {!!p.codes?.length && <Text numberOfLines={1} style={[styles.small, {fontSize: 12}]}>{p.codes.map(c=>c.code).join(' · ')}</Text>}
                  {line && <Badge text={`En la venta: ${line.milli ? quantityLabel(line.milli, p.unit) : line.quantity}`} icon="check" tone="accent"/>}
                </View>
                <Button title={out ? 'Agotado' : 'Agregar'} icon={out ? undefined : 'plus'} size="sm" variant="secondary" disabled={out} onPress={() => quickAdd(p)} testID={`add-${p.name}`}/>
              </Pressable>;
            })}
          </View>
          {visible.length > limit && <Button title={`Ver más productos (${visible.length - limit})`} variant="outline" onPress={() => setLimit(limit + PAGE)}/>}
        </> : null}
          {(view === 'cart' || lines.length > 0) && <Text accessibilityRole="header" style={styles.sectionTitle}>En esta venta{lines.length ? ` · ${lines.length}` : ''}</Text>}
          {lines.length === 0 && view === 'cart' && <Empty icon="shopping-cart" title="La venta está vacía" text="Busca un producto y tócalo para agregarlo." action="Ver productos" onAction={() => setView('catalog')}/>}
          {lines.map(l => <Card key={l.product.id} style={{gap: 10, paddingVertical: 12, paddingHorizontal: 14}}>
            <View style={[styles.row, {alignItems: 'flex-start'}]}>
              <View style={{flex: 1}}><Text style={{fontSize: 16, fontWeight: '700', color: colors.ink}}>{l.product.name}</Text><Text style={styles.small}>{cop(l.product.price_cents)} / {l.product.unit === 'kg' ? 'kg' : 'unidad'}</Text></View>
              <IconButton icon="trash-2" label={`Quitar ${l.product.name}`} tone="gray" size={40} onPress={() => remove(l.product.id)}/>
            </View>
            <View style={[styles.row, {flexWrap: 'wrap'}]}>
              <Stepper label={l.product.unit === 'kg' ? `Kilos de ${l.product.name}` : `Unidades de ${l.product.name}`} value={l.quantity} unit={unitLabel(l.product.unit)} onChange={q => setLine(l.product, q)} onStep={d => step(l, d)} testID={`qty-${l.product.name}`}/>
              <Text style={[styles.money, {fontSize: 17}]}>{cop(l.subtotal)}</Text>
            </View>
            {l.milli === null && <Text accessibilityRole="alert" style={styles.fieldError}>{l.product.unit === 'kg' ? 'Escribe el peso, por ejemplo 0,25 o 1,5' : 'Escribe una cantidad entera mayor a cero'}</Text>}
            {l.short && <Text style={styles.fieldError}>Solo hay {quantityLabel(l.product.stock_milli!, l.product.unit)} disponibles</Text>}
          </Card>)}

      </>}
    </Page>

    <Confirm visible={clearCart} title="¿Cancelar esta venta?" message={`Se quitarán los ${lines.length} productos agregados. La venta todavía no se ha registrado.`} confirmText="Iniciar otra venta" danger onCancel={() => setClearCart(false)} onConfirm={() => { reset(); setClearCart(false); }}/>
    <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.name || ''} subtitle={editing ? `${cop(editing.price_cents)} · ${editing.unit === 'kg'?'¿Cuántos kilogramos desea vender?':'¿Cuántas unidades desea agregar?'}` : ''}
      footer={editing && <>
        <Button title={`Agregar · ${cop(editMilli ? lineSubtotal(editing.price_cents, editMilli) : 0)}`} icon="check" size="lg" disabled={editMilli === null || !!editShort} onPress={saveQuantity} testID="quantity-save"/>
        {inCart(editing.id) && <Button title="Quitar de la venta" variant="ghost" onPress={() => { remove(editing.id); setEditing(null); }}/>}
      </>}>
      {editing && <>
        <Field label={editing.unit === 'kg' ? 'Peso en kilogramos' : 'Cantidad en unidades'} kind={editing.unit === 'kg' ? 'decimal' : 'number'} value={qtyText} onChange={setQtyText} autoFocus large onSubmit={saveQuantity} placeholder={editing.unit === 'kg' ? '0,25' : '1'} testID="quantity-input"
          error={qtyText && editMilli === null ? (editing.unit === 'kg' ? 'Usa coma o punto para decimales: 0,25 · 1,5 · 125,5' : 'Solo números enteros') : editShort ? `Solo hay ${quantityLabel(editing.stock_milli!, editing.unit)} disponibles` : null}
          hint={editing.unit === 'kg' ? 'Ejemplos: 0,25 = media libra · 0,5 = una libra · 1,75 = kilo y tres cuartos' : undefined} right={<Text style={[styles.h2, {color: colors.muted}]}>{unitLabel(editing.unit)}</Text>}/>
        <Choice items={(editing.unit === 'kg' ? KG_PRESETS : UNIT_PRESETS).map(v => ({id: v, name: `${v} ${unitLabel(editing.unit)}`}))} value={qtyText} onChange={setQtyText}/>
      </>}
    </Sheet>

    <Sheet visible={pickCustomer} onClose={() => setPickCustomer(false)} title={newCustomer ? 'Nuevo cliente' : 'Elegir cliente'} subtitle={newCustomer ? 'Se guarda y queda seleccionado en esta venta' : undefined}
      footer={newCustomer ? <>
        <SearchSelect label="Ruta del cliente (obligatoria)" items={route?[route]:[]} value={route?.id||''} disabled onChange={()=>{}}/>
        <Button title="Crear y seleccionar" icon="user-plus" size="lg" disabled={busy || !name.trim() || !city.trim()} loading={busy} testID="customer-create"
          onPress={() => run(async () => { const c = await api<Customer>('/customers', 'POST', {name: name.trim(), city: city.trim(),customer_type:newType,route_id:route!.id}); await chooseCustomer(c.id); setNewCustomer(false); setName(''); setCity(''); await refresh(); }, 'Cliente guardado')}/>
        <Button title="Volver a la lista" variant="ghost" onPress={() => setNewCustomer(false)}/>
      </> : <Button title="Crear cliente nuevo" icon="user-plus" variant="secondary" onPress={() => { setNewCustomer(true); setName(customerSearch.trim()); }} testID="customer-new"/>}>
      {newCustomer ? <>
        <SearchSelect label="Ruta del cliente (obligatoria)" items={route?[route]:[]} value={route?.id||''} disabled onChange={()=>{}}/>
        <Field label="Nombre del cliente" kind="name" value={name} onChange={setName} autoFocus placeholder="Ej. Manuel Rodríguez"/>
        <Choice items={[{id:'normal',name:'Normal'},{id:'wholesale',name:'Mayorista'}]} value={newType} onChange={setNewType}/><Field label="Ciudad o municipio" kind="name" value={city} onChange={setCity} placeholder="Ej. El Rosal"/>
      </> : <>
        <SearchBar value={customerSearch} onChange={setCustomerSearch} placeholder="Buscar por nombre o ciudad" testID="customer-search"/>
        {customerMatches.length === 0 && <Text style={[styles.muted, {textAlign: 'center', paddingVertical: 12}]}>{customers.length ? 'Ningún cliente coincide. Créalo con el botón de abajo.' : 'Todavía no hay clientes. Crea el primero.'}</Text>}
        <View>{customerMatches.map(c => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.city}`} onPress={() => run(()=>chooseCustomer(c.id))}
          style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 56}, pressed && {backgroundColor: colors.accentSoft}]}>
          <View style={{width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center'}}><Text style={{fontWeight: '800', color: colors.accent}}>{c.name[0]?.toUpperCase()}</Text></View>
          <View style={{flex: 1}}><Text style={{fontSize: 15, fontWeight: '700', color: colors.ink}}>{c.name}</Text><Text style={styles.small}>{c.city}</Text></View>
          {c.id === customer && <Feather name="check-circle" size={20} color={colors.accent}/>}
        </Pressable>)}</View>
      </>}
    </Sheet>
  </>;
}
/** Billetes con los que suele pagar el cliente: exacto y redondeos hacia arriba. */
function cashSuggestions(total: number) {
  if (total <= 0) return [];
  const values = new Set([total]);
  for (const step of [100000, 500000, 1000000, 2000000, 5000000, 10000000]) { const v = Math.ceil(total / step) * step; if (v > total) values.add(v); }
  return [...values].sort((a, b) => a - b).slice(0, 4);
}
function StatusRow({ok, text}: {ok?: boolean; text: string}) {
  return <View style={[styles.row, {justifyContent: 'flex-start', gap: 8, alignItems: 'flex-start'}]}>
    <Feather name={ok ? 'check-circle' : 'clock'} size={16} color={ok ? colors.greenDark : colors.muted} style={{marginTop: 2}}/>
    <Text style={[styles.muted, {flex: 1}]}>{text}</Text>
  </View>;
}
