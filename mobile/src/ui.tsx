import React, {useEffect, useRef, useState, type Ref} from 'react';
import {ActivityIndicator, Animated, BackHandler, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {fitSize} from './format';
export * from './format';

// Sistema visual DOK POLLO MC: fondo marfil, superficies blancas y texto carbón. El morado de la marca
// identifica acciones principales, foco, selección y la sección actual; el resto de la interfaz es neutra. Verde, naranja y rojo quedan para estados operativos.
export const colors = {
  bg: '#F6F5F2', surface: '#FFFFFF', ink: '#202124', text: '#3C3F44', muted: '#5F6368', line: '#E4E2DD', lineStrong: '#CBC8C1', subtle: '#EFEDE8',
  accent: '#6D3BA6', accentDark: '#55288A', accentSoft: '#F0EAF7', accentLine: '#D9C9EC',
  // Estados operativos (los nombres green* se conservan para "correcto / cuadra / sincronizado").
  green: '#1E7A3C', greenDark: '#17602F', greenSoft: '#E7F3EA', greenLine: '#C9E2CF',
  yellow: '#F5BE2E', yellowSoft: '#FFF5D6', orange: '#A8520C', orangeSoft: '#FCEFE0', red: '#B3261E', redSoft: '#FCE9E7',
  white: '#FFFFFF', mint: '#E7F3EA',
};
export const space = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24};
export const radius = {sm: 10, md: 12, lg: 16, pill: 999};
type Icon = React.ComponentProps<typeof Feather>['name'];
export type Tone = 'green' | 'orange' | 'red' | 'gray' | 'yellow' | 'accent';
const toneColors: Record<Tone, {bg: string; fg: string}> = {
  green: {bg: colors.greenSoft, fg: colors.greenDark}, orange: {bg: colors.orangeSoft, fg: colors.orange}, red: {bg: colors.redSoft, fg: colors.red},
  gray: {bg: colors.subtle, fg: colors.text}, yellow: {bg: colors.yellowSoft, fg: '#6E4E00'}, accent: {bg: colors.accentSoft, fg: colors.accentDark},
};

/** Teclado virtual visible: permite ocultar la navegación inferior y dejar espacio al campo activo. */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true)), hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}

const LOGO = require('../assets/brand/dok-pollo-mc.png');
/** Ícono suministrado por el negocio, conservando su proporción cuadrada. */
export function Logo({width = 44}: {width?: number}) {
  return <Image source={LOGO} accessibilityLabel="Logo DOK POLLO MC" resizeMode="contain" style={{width, height: width}}/>;
}

// ── Pila de "atrás": hojas y subpantallas registran su cierre para el botón físico de Android.
const backStack: (() => void)[] = [];
export function useBack(active: boolean, handler: () => void) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const fn = () => ref.current();
    backStack.push(fn);
    return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); };
  }, [active]);
}
export function handleBack() { const top = backStack[backStack.length - 1]; if (!top) return false; top(); return true; }
export function useHardwareBack(fallback: () => boolean) {
  const ref = useRef(fallback); ref.current = fallback;
  useEffect(() => { if (Platform.OS !== 'android') return; const sub = BackHandler.addEventListener('hardwareBackPress', () => handleBack() || ref.current()); return () => sub.remove(); }, []);
}

type ButtonProps = {title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: Icon; disabled?: boolean; loading?: boolean; testID?: string; style?: StyleProp<ViewStyle>; secondary?: boolean; danger?: boolean};
export function Button({title, onPress, variant, size = 'md', icon, disabled = false, loading = false, testID, style, secondary, danger}: ButtonProps) {
  const kind = variant || (danger ? 'danger' : secondary ? 'secondary' : 'primary');
  const fg = kind === 'primary' || kind === 'danger' ? colors.white : kind === 'outline' && danger ? colors.red : kind === 'ghost' ? colors.accentDark : colors.ink;
  const off = disabled || loading;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{disabled: off, busy: loading}} disabled={off} onPress={onPress}
    style={({pressed}) => [styles.button, size === 'lg' && styles.buttonLg, size === 'sm' && styles.buttonSm, buttonKinds[kind], pressed && !off && buttonPressed[kind], off && styles.buttonOff, off && kind !== 'ghost' && kind !== 'outline' && {backgroundColor: '#D9D7D2'}, style]}>
    {loading ? <ActivityIndicator size="small" color={off && kind !== 'ghost' && kind !== 'outline' ? colors.text : fg}/> : icon && <Feather name={icon} size={size === 'lg' ? 20 : 18} color={off && kind !== 'ghost' && kind !== 'outline' ? colors.muted : fg}/>}
    <Text selectable={false} numberOfLines={1} style={[styles.buttonText, size === 'lg' && {fontSize: 17}, size === 'sm' && {fontSize: 14}, {color: off && kind !== 'ghost' && kind !== 'outline' ? colors.muted : fg}]}>{title}</Text>
  </Pressable>;
}
const buttonKinds = StyleSheet.create({
  primary: {backgroundColor: colors.accent}, secondary: {backgroundColor: colors.subtle}, danger: {backgroundColor: colors.red},
  outline: {backgroundColor: colors.white, borderWidth: 1, borderColor: colors.lineStrong}, ghost: {backgroundColor: 'transparent', paddingHorizontal: 10},
});
const buttonPressed = StyleSheet.create({
  primary: {backgroundColor: colors.accentDark}, secondary: {backgroundColor: '#E3E0D9'}, danger: {backgroundColor: '#8F1E18'}, outline: {backgroundColor: colors.subtle}, ghost: {backgroundColor: colors.accentSoft},
});
export function IconButton({icon, label, onPress, tone = 'gray', size = 44, disabled, testID}: {icon: Icon; label: string; onPress: () => void; tone?: Tone | 'solid'; size?: number; disabled?: boolean; testID?: string}) {
  const c = tone === 'solid' ? {bg: colors.accent, fg: colors.white} : toneColors[tone];
  // El área táctil llega a 48 aunque el círculo visible sea menor.
  const slop = Math.max(4, Math.ceil((48 - size) / 2));
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !!disabled}} disabled={disabled} onPress={onPress} hitSlop={slop}
    style={({pressed}) => [{width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center'}, pressed && {opacity: 0.7}, disabled && {opacity: 0.4}]}>
    <Feather name={icon} size={Math.round(size * 0.44)} color={c.fg}/>
  </Pressable>;
}

type FieldProps = {label: string; value: string; onChange: (text: string) => void; placeholder?: string; secure?: boolean; kind?: 'text' | 'plain' | 'name' | 'decimal' | 'number' | 'phone' | 'date'; numeric?: boolean; hint?: string; error?: string | null; autoFocus?: boolean; onSubmit?: () => void; returnKey?: 'next' | 'done' | 'search' | 'go'; inputRef?: Ref<React.ComponentRef<typeof TextInput>>; multiline?: boolean; prefix?: string; right?: React.ReactNode; testID?: string; large?: boolean; required?: boolean; autoComplete?: 'username' | 'password' | 'off' | 'name' | 'tel'};
/**
 * Campo con etiqueta permanente. El error se muestra después de que la persona sale del campo (o intenta enviar),
 * no mientras escribe por primera vez; una vez visto, se actualiza en vivo hasta corregirse.
 */
export function Field({label, value, onChange, placeholder, secure = false, kind, numeric, hint, error, autoFocus, onSubmit, returnKey, inputRef, multiline, prefix, right, testID, large, required, autoComplete}: FieldProps) {
  const type = kind || (numeric ? 'decimal' : 'text');
  const [focused, setFocused] = useState(false), [touched, setTouched] = useState(false);
  const keyboard = type === 'decimal' ? 'decimal-pad' : type === 'number' ? 'number-pad' : type === 'phone' ? 'phone-pad' : type === 'date' ? 'numbers-and-punctuation' : 'default';
  const shownError = error && (touched || !focused) ? error : null;
  const key = returnKey || (onSubmit ? 'done' : undefined);
  return <View style={{gap: 6}}>
    <Text style={styles.label}>{label}{required && <Text style={{color: colors.muted, fontWeight: '500'}}> · obligatorio</Text>}</Text>
    <View style={[styles.inputBox, large && {minHeight: 60}, focused && styles.inputFocus, !!shownError && {borderColor: colors.red, borderWidth: 2}, multiline && {alignItems: 'flex-start'}]}>
      {prefix && <Text style={[styles.prefix, large && {fontSize: 22}]}>{prefix}</Text>}
      <TextInput ref={inputRef} testID={testID} accessibilityLabel={label} accessibilityHint={shownError || hint} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#8A8D91" secureTextEntry={secure}
        keyboardType={keyboard} inputMode={type === 'decimal' ? 'decimal' : type === 'number' ? 'numeric' : type === 'phone' ? 'tel' : 'text'} autoCapitalize={type === 'name' ? 'words' : type === 'text' && !secure ? 'sentences' : 'none'}
        autoComplete={autoComplete} autoCorrect={false} autoFocus={autoFocus} onSubmitEditing={() => { setTouched(true); onSubmit?.(); }} returnKeyType={key} enterKeyHint={key} submitBehavior={key === 'next' ? 'submit' : undefined}
        multiline={multiline} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); if (value) setTouched(true); }}
        style={[styles.input, large && {fontSize: 24, fontWeight: '700'}, multiline && {minHeight: 84, textAlignVertical: 'top', paddingTop: 12}, Platform.OS === 'web' && ({outlineStyle: 'none'} as object)]}/>
      {right}
    </View>
    {shownError ? <View style={styles.fieldErrorRow}><Feather name="alert-circle" size={14} color={colors.red}/><Text style={[styles.fieldError, {flex: 1}]}>{shownError}</Text></View> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}
export function SearchBar({value, onChange, placeholder, autoFocus, testID, inputRef, onSubmit}: {value: string; onChange: (t: string) => void; placeholder: string; autoFocus?: boolean; testID?: string; inputRef?: Ref<React.ComponentRef<typeof TextInput>>; onSubmit?: () => void}) {
  const [focused, setFocused] = useState(false);
  return <View style={[styles.search, focused && styles.inputFocus]}>
    <Feather name="search" size={18} color={focused ? colors.accent : colors.muted}/>
    <TextInput ref={inputRef} testID={testID} accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#8A8D91" autoFocus={autoFocus} autoCorrect={false} autoCapitalize="none" returnKeyType="search" enterKeyHint="search"
      onSubmitEditing={onSubmit} submitBehavior={onSubmit ? 'submit' : undefined} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.searchInput, Platform.OS === 'web' && ({outlineStyle: 'none'} as object)]}/>
    {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={12} onPress={() => onChange('')}><Feather name="x-circle" size={18} color={colors.muted}/></Pressable>}
  </View>;
}
export function Card({children, style, onPress, testID, tone}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string; tone?: Tone}) {
  const tint = tone && {backgroundColor: toneColors[tone].bg, borderColor: 'transparent'};
  if (!onPress) return <View testID={testID} style={[styles.card, tint, style]}>{children}</View>;
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({pressed}) => [styles.card, tint, pressed && {backgroundColor: colors.subtle}, style]}>{children}</Pressable>;
}
export function Badge({text, tone, good = true, icon}: {text: string; tone?: Tone; good?: boolean; icon?: Icon}) {
  const c = toneColors[tone || (good ? 'green' : 'orange')];
  return <View style={[styles.badge, {backgroundColor: c.bg}]}>{icon && <Feather name={icon} size={12} color={c.fg}/>}<Text numberOfLines={1} style={[styles.badgeText, {color: c.fg}]}>{text}</Text></View>;
}
export function Header({eyebrow, title, subtitle, right}: {eyebrow?: string; title: string; subtitle?: string; right?: React.ReactNode}) {
  return <View style={[styles.row, {alignItems: 'center'}]}>
    <View style={{flex: 1, gap: 2}}>{eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}<Text accessibilityRole="header" style={styles.title}>{title}</Text>{subtitle && <Text style={styles.muted}>{subtitle}</Text>}</View>
    {right}
  </View>;
}
export function Section({title, action, onAction, children}: {title: string; action?: string; onAction?: () => void; children?: React.ReactNode}) {
  return <View style={{gap: 8}}>
    <View style={[styles.row, {minHeight: 28}]}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{action && onAction && <Pressable accessibilityRole="button" hitSlop={12} onPress={onAction}><Text style={styles.link}>{action}</Text></Pressable>}</View>
    {children}
  </View>;
}
export function Stat({label, value, icon, tone = 'gray', testID}: {label: string; value: string; icon?: Icon; tone?: Tone; testID?: string}) {
  const c = toneColors[tone];
  return <View testID={testID} style={styles.stat}>
    <View style={[styles.row, {justifyContent: 'flex-start', gap: 6}]}>{icon && <Feather name={icon} size={14} color={c.fg}/>}<Text numberOfLines={1} style={[styles.small, {flex: 1}]}>{label}</Text></View>
    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, {fontSize: fitSize(value, 19, 9)}]}>{value}</Text>
  </View>;
}
export function Metric({label, value, accent = false}: {label: string; value: string; accent?: boolean}) {
  return <View style={{flex: 1, minWidth: 120, gap: 4}}><Text style={styles.small}>{label}</Text><Text numberOfLines={1} style={[styles.metric, {fontSize: fitSize(value, 22)}, accent && {color: colors.accentDark}]}>{value}</Text></View>;
}
/** Fila etiqueta → valor, alineada a la derecha. */
export function InfoRow({label, value, strong, tone}: {label: string; value: string; strong?: boolean; tone?: Tone}) {
  return <View style={[styles.row, {paddingVertical: 3, alignItems: 'flex-start'}]}>
    <Text style={[styles.body, {color: colors.muted, flexShrink: 1}]}>{label}</Text>
    <Text style={[styles.body, {flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums']}, strong && {fontWeight: '700', color: colors.ink}, tone && {color: toneColors[tone].fg, fontWeight: '700'}]}>{value}</Text>
  </View>;
}
export function Empty({title, text, icon = 'inbox', action, onAction}: {title: string; text: string; icon?: Icon; action?: string; onAction?: () => void}) {
  return <View style={styles.empty}>
    <View style={styles.emptyIcon}><Feather name={icon} size={24} color={colors.accent}/></View>
    <Text style={[styles.h2, {textAlign: 'center'}]}>{title}</Text>
    <Text style={[styles.muted, {textAlign: 'center', maxWidth: 320}]}>{text}</Text>
    {action && onAction && <Button title={action} onPress={onAction} variant="secondary" size="sm" style={{marginTop: 4, alignSelf: 'center', paddingHorizontal: 18}}/>}
  </View>;
}
export function Loading({text = 'Cargando…'}: {text?: string}) {
  return <View style={[styles.empty, {borderWidth: 0, backgroundColor: 'transparent'}]}><ActivityIndicator color={colors.accent}/><Text style={styles.muted}>{text}</Text></View>;
}
export function Busy() { return <ActivityIndicator color={colors.accent}/>; }
/** Aviso persistente: error con detalle técnico opcional, advertencia o éxito. */
export function Banner({tone = 'red', title, text, detail, onClose, action, onAction}: {tone?: Tone; title?: string; text: string; detail?: string; onClose?: () => void; action?: string; onAction?: () => void}) {
  const [open, setOpen] = useState(false); const c = toneColors[tone];
  const icon: Icon = tone === 'green' ? 'check-circle' : tone === 'red' ? 'alert-circle' : tone === 'gray' || tone === 'accent' ? 'info' : 'alert-triangle';
  return <View accessibilityRole="alert" style={[styles.banner, {backgroundColor: c.bg}]}>
    <Feather name={icon} size={18} color={c.fg} style={{marginTop: 1}}/>
    <View style={{flex: 1, gap: 4}}>
      {title && <Text style={{color: c.fg, fontWeight: '700', fontSize: 15}}>{title}</Text>}
      <Text style={{color: c.fg, fontSize: 14, lineHeight: 20}}>{text}</Text>
      {detail && <Pressable hitSlop={8} onPress={() => setOpen(!open)}><Text style={{color: c.fg, fontSize: 13, textDecorationLine: 'underline'}}>{open ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}</Text></Pressable>}
      {open && detail && <Text selectable style={{color: c.fg, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'}}>{detail}</Text>}
      {action && onAction && <Button title={action} onPress={onAction} size="sm" variant={tone === 'red' ? 'danger' : 'primary'} style={{alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 16}}/>}
    </View>
    {onClose && <Pressable accessibilityRole="button" accessibilityLabel="Cerrar aviso" hitSlop={14} onPress={onClose}><Feather name="x" size={18} color={c.fg}/></Pressable>}
  </View>;
}
/** Un solo contenedor de desplazamiento por vista; el pie fijo ocupa su propio espacio y nunca tapa el contenido. */
export function Page({children, footer, onRefresh, refreshing = false, testID}: {children: React.ReactNode; footer?: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; testID?: string}) {
  return <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView testID={testID} style={{flex: 1}} keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={styles.page}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.accent]} tintColor={colors.accent}/> : undefined}>{children}</ScrollView>
    {footer}
  </KeyboardAvoidingView>;
}
/** Barra fija sobre la navegación inferior: nunca tapa el contenido porque ocupa su propio espacio. */
export function FooterBar({children}: {children: React.ReactNode}) {
  return <View style={styles.footerBar}><View style={styles.footerInner}>{children}</View></View>;
}
export function Segmented({items, value, onChange, testID}: {items: {id: string; name: string}[]; value: string; onChange: (id: string) => void; testID?: string}) {
  return <View testID={testID} accessibilityRole="tablist" style={styles.segmented}>{items.map(item => {
    const on = value === item.id;
    return <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.name} accessibilityState={{selected: on}} onPress={() => onChange(item.id)} style={[styles.segment, on && styles.segmentOn]}>
      <Text numberOfLines={1} style={[styles.segmentText, on && {color: colors.ink}]}>{item.name}</Text>
    </Pressable>;
  })}</View>;
}
export function Choice({items, value, onChange}: {items: {id: string; name: string}[]; value: string; onChange: (id: string) => void}) {
  return <View style={styles.wrap}>{items.map(item => <Chip key={item.id} text={item.name} on={value === item.id} onPress={() => onChange(item.id)}/>)}</View>;
}
/** Chip de selección: morado suave con verificación cuando está activo. */
export function Chip({text, on, onPress, icon}: {text: string; on: boolean; onPress: () => void; icon?: Icon}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityState={{selected: on}} onPress={onPress} style={({pressed}) => [styles.chip, on && styles.chipOn, pressed && !on && {backgroundColor: colors.subtle}]}>
    {on ? <Feather name="check" size={14} color={colors.accentDark}/> : icon && <Feather name={icon} size={14} color={colors.text}/>}<Text numberOfLines={1} style={[styles.chipText, on && {color: colors.accentDark}]}>{text}</Text>
  </Pressable>;
}
export function Divider() { return <View style={styles.divider}/>; }
/** Hoja inferior para formularios y selecciones rápidas. Botón atrás de Android la cierra. */
export function Sheet({visible, onClose, title, subtitle, children, footer}: {visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode}) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable accessibilityLabel="Cerrar" style={styles.scrim} onPress={onClose}/>
      <View style={[styles.sheet, {paddingBottom: Math.max(insets.bottom, 12)}]}>
        <View style={styles.grabber}/>
        <View style={[styles.row, {paddingHorizontal: 16, paddingBottom: 10}]}>
          <View style={{flex: 1, gap: 2}}><Text accessibilityRole="header" style={styles.h2}>{title}</Text>{subtitle && <Text style={styles.small}>{subtitle}</Text>}</View>
          <IconButton icon="x" label="Cerrar" onPress={onClose} size={40}/>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal: 16, paddingBottom: 12, gap: 14}}>{children}</ScrollView>
        {footer && <View style={{paddingHorizontal: 16, paddingTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: colors.line}}>{footer}</View>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
/** Confirmación explícita para acciones definitivas. Confirmar y cancelar quedan separados. */
export function Confirm({visible, title, message, confirmText, onConfirm, onCancel, danger, busy, children}: {visible: boolean; title: string; message: string; confirmText: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; busy?: boolean; children?: React.ReactNode}) {
  return <Sheet visible={visible} onClose={onCancel} title={title} footer={<>
    <Button title={confirmText} variant={danger ? 'danger' : 'primary'} size="lg" loading={busy} onPress={onConfirm}/>
    <Button title="Cancelar" variant="ghost" onPress={onCancel} disabled={busy} style={{marginTop: 4}}/>
  </>}><Text style={styles.body}>{message}</Text>{children}</Sheet>;
}
/** Selector de cantidad: −  [valor editable]  + */
export function Stepper({value, onChange, onStep, unit, testID, label}: {value: string; onChange: (t: string) => void; onStep: (direction: 1 | -1) => void; unit: string; testID?: string; label: string}) {
  return <View style={styles.stepper}>
    <IconButton icon="minus" label={`Restar ${label}`} onPress={() => onStep(-1)} size={40} tone="gray"/>
    <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType="decimal-pad" inputMode="decimal" selectTextOnFocus
      style={[styles.stepperInput, Platform.OS === 'web' && ({outlineStyle: 'none'} as object)]}/>
    <Text style={[styles.small, {minWidth: 24}]}>{unit}</Text>
    <IconButton icon="plus" label={`Sumar ${label}`} onPress={() => onStep(1)} size={40} tone="solid"/>
  </View>;
}
/** Barra de progreso indeterminada y discreta: no desplaza el contenido. */
export function ProgressBar({active}: {active: boolean}) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(Animated.timing(x, {toValue: 1, duration: 1100, useNativeDriver: Platform.OS !== 'web'}));
    loop.start(); return () => { loop.stop(); x.setValue(0); };
  }, [active, x]);
  if (!active) return null;
  return <View accessibilityLabel="Procesando" style={styles.progress}><Animated.View style={[styles.progressBar, {transform: [{translateX: x.interpolate({inputRange: [0, 1], outputRange: [-160, 520]})}]}]}/></View>;
}

export const styles = StyleSheet.create({
  page: {padding: 16, gap: 14, paddingBottom: 24, width: '100%', maxWidth: 720, alignSelf: 'center'},
  title: {fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: colors.ink},
  eyebrow: {fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: colors.muted},
  h2: {fontSize: 17, fontWeight: '700', color: colors.ink},
  sectionTitle: {fontSize: 15, fontWeight: '700', color: colors.ink},
  body: {fontSize: 16, color: colors.text, lineHeight: 22},
  muted: {fontSize: 14, color: colors.muted, lineHeight: 20},
  small: {fontSize: 13, color: colors.muted, lineHeight: 18},
  label: {fontSize: 14, fontWeight: '600', color: colors.ink},
  hint: {fontSize: 13, color: colors.muted, lineHeight: 18},
  fieldError: {fontSize: 13, color: colors.red, fontWeight: '600', lineHeight: 18},
  fieldErrorRow: {flexDirection: 'row', gap: 6, alignItems: 'flex-start'},
  inputBox: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, backgroundColor: colors.white, minHeight: 52, paddingHorizontal: 14, gap: 8},
  inputFocus: {borderColor: colors.accent, borderWidth: 2},
  input: {flex: 1, minHeight: 48, color: colors.ink, fontSize: 16, paddingVertical: 0},
  prefix: {fontSize: 16, color: colors.muted, fontWeight: '700'},
  search: {flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 52},
  searchInput: {flex: 1, fontSize: 16, color: colors.ink, minHeight: 48},
  card: {backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12},
  button: {flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
  buttonLg: {minHeight: 56, borderRadius: radius.md},
  buttonSm: {minHeight: 44, paddingHorizontal: 12, borderRadius: radius.sm},
  buttonOff: {opacity: 0.9},
  buttonText: {fontSize: 16, fontWeight: '700', flexShrink: 1},
  secondary: {backgroundColor: colors.subtle},
  badge: {alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, maxWidth: '100%'},
  badgeText: {fontSize: 12, fontWeight: '700'},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  wrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.white},
  chipOn: {backgroundColor: colors.accentSoft, borderColor: colors.accent},
  chipText: {fontSize: 14, fontWeight: '600', color: colors.ink},
  segmented: {flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.md, padding: 3, gap: 3},
  segment: {flex: 1, minHeight: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6},
  segmentOn: {backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line},
  segmentText: {fontSize: 14, fontWeight: '700', color: colors.muted},
  metric: {fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.4, fontVariant: ['tabular-nums']},
  stat: {flexGrow: 1, flexBasis: '40%', minWidth: 112, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingVertical: 10, paddingHorizontal: 12, gap: 4},
  statIcon: {width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  statValue: {fontSize: 19, fontWeight: '800', color: colors.ink, letterSpacing: -0.3, fontVariant: ['tabular-nums']},
  money: {fontVariant: ['tabular-nums'], fontWeight: '700', color: colors.ink},
  divider: {height: 1, backgroundColor: colors.line},
  link: {fontSize: 15, color: colors.accentDark, fontWeight: '700'},
  error: {backgroundColor: colors.redSoft, padding: 14, borderRadius: radius.md, color: colors.red, fontSize: 14, lineHeight: 20},
  empty: {alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 20, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line},
  emptyIcon: {width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 2},
  banner: {flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.md, alignItems: 'flex-start'},
  footerBar: {backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 16, paddingVertical: 10},
  footerInner: {width: '100%', maxWidth: 720, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12},
  scrim: {flex: 1, backgroundColor: 'rgba(24,24,27,0.45)'},
  sheet: {backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%', paddingTop: 8, width: '100%', maxWidth: 640, alignSelf: 'center'},
  grabber: {width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, alignSelf: 'center', marginBottom: 10},
  stepper: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.subtle, borderRadius: radius.pill, padding: 4},
  stepperInput: {minWidth: 60, maxWidth: 90, height: 40, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.ink, backgroundColor: colors.white, borderRadius: radius.sm, paddingHorizontal: 4},
  progress: {position: 'absolute', top: 0, left: 0, right: 0, height: 3, overflow: 'hidden', backgroundColor: colors.accentSoft, zIndex: 20},
  progressBar: {width: 160, height: 3, backgroundColor: colors.accent, borderRadius: 2},
  nav: {flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 4},
  navItem: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 6, paddingBottom: 6, gap: 2, minHeight: 60},
  navText: {fontSize: 11, fontWeight: '600', color: colors.muted},
});
