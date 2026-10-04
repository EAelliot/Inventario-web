// ============================================================================
  //  Estado global de la sesión y de la pantalla actual
  // ============================================================================
  var estado = { token: null, usuario: null, nombre: null, rol: null, idUsuario: null };
  var productoActual = null;
  var ubicacionesCache = null;
  var vistaActual = null;
  var estadoCamara = {};
  var ultimoCodigoLeido = null;
  var ultimoCodigoTiempo = 0;
  var ultimaListaProductos = [];
  var productosSeleccionados = {};

  var VISTA_ID_MAP = { ubicaciones: 'ubicaciones-admin' };

  // ============================================================================
  //  Puente con el backend (Apps Script publicado como API vía doPost)
  // ============================================================================
  // Pega aqui la URL de tu implementacion de Apps Script (termina en /exec).
  var EXEC_URL = 'https://script.google.com/macros/s/AKfycbw-yW473bOGgNB_Vw1dkU-X_xgeMb48DBudgg4lHCKt353iRFVWzQUSfifzSCIxJn8h/exec';

  function callServer(fnName, args, onOk, onErr) {
    var token = null, payload = {};
    if (fnName === 'login') {
      payload = args[0];
    } else {
      token = args[0];
      payload = args[1] !== undefined ? args[1] : {};
    }
    fetch(EXEC_URL, {
      method: 'POST',
      // text/plain evita que el navegador mande una peticion de "preflight" (OPTIONS)
      // que Apps Script no sabe responder. El backend igual lee esto como JSON.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: fnName, token: token, payload: payload })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (res.ok) { if (onOk) onOk(res.data); }
      else {
        var msg = res.error || 'NO SE PUDO CONECTAR — Verifica tu conexión e inténtalo nuevamente.';
        if (onErr) onErr(msg); else window.alert(msg);
      }
    }).catch(function () {
      var msg = 'NO SE PUDO CONECTAR — Verifica tu conexión a Internet e inténtalo nuevamente.';
      if (onErr) onErr(msg); else window.alert(msg);
    });
  }

  // ============================================================================
  //  Utilidades de UI
  // ============================================================================
  function escapeHtml(s) {
    return (s === null || s === undefined ? '' : s.toString()).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mostrarMensaje(elId, texto, tipo) {
    var el = document.getElementById(elId);
    if (!el) return;
    var partes = (texto || '').split(' — ');
    var titulo = partes.length > 1 ? partes[0] : (tipo === 'ok' ? 'Listo' : tipo === 'warn' ? 'Aviso' : 'No se pudo continuar');
    var cuerpo = partes.length > 1 ? partes.slice(1).join(' — ') : texto;
    var clase = tipo === 'ok' ? 'msg-ok' : (tipo === 'warn' ? 'msg-warn' : 'msg-error');
    el.innerHTML = '<div class="' + clase + '"><b>' + escapeHtml(titulo) + '</b>' + escapeHtml(cuerpo) + '</div>';
  }

  function limpiarMensaje(elId) {
    var el = document.getElementById(elId);
    if (el) el.innerHTML = '';
  }

  function formatearNumero_(n) {
    try { return Number(n).toLocaleString('es-PE'); } catch (e) { return n; }
  }

  // ============================================================================
  //  Navegación entre pantallas
  // ============================================================================
  function idDeVista(nombre) { return VISTA_ID_MAP[nombre] || nombre; }

  function mostrarVista(nombre) {
    if (vistaActual === 'scan' && nombre !== 'scan') detenerCamara();
    vistaActual = nombre;
    document.querySelectorAll('#view-app .view').forEach(function (v) { v.classList.add('oculto'); });
    var el = document.getElementById('view-' + idDeVista(nombre));
    if (el) el.classList.remove('oculto');
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('activo', b.dataset.ir === nombre); });
    window.scrollTo(0, 0);
    onEntrarVista(nombre);
  }

  function onEntrarVista(nombre) {
    if (nombre === 'home') {
      document.getElementById('home-nombre').textContent = estado.nombre;
    } else if (nombre === 'scan') {
      document.getElementById('scan-manual').value = '';
      limpiarMensaje('scan-msg');
      iniciarCamara();
    } else if (nombre === 'stock') {
      document.getElementById('st-buscar').value = '';
      buscarStock('');
    } else if (nombre === 'ubicacion') {
      prepararTabsUbicacion();
    } else if (nombre === 'historial') {
      cargarHistorial({});
    } else if (nombre === 'resumen') {
      cargarResumen();
    } else if (nombre === 'productos') {
      document.getElementById('pr-buscar').value = '';
      document.getElementById('pr-qr-card').classList.add('oculto');
      cargarListaProductos('');
    } else if (nombre === 'ubicaciones-admin') {
      cargarListaUbicacionesAdmin();
    } else if (nombre === 'usuarios') {
      cargarListaUsuarios();
    }
  }

  function cargarUbicacionesSiHaceFalta(cb) {
    if (ubicacionesCache) { cb(); return; }
    callServer('listarUbicaciones', [estado.token, {}], function (lista) { ubicacionesCache = lista; cb(); }, function (msg) {
      window.alert(msg);
    });
  }

  function llenarSelectUbicaciones(selectEl, ubicaciones, valorSeleccionado) {
    selectEl.innerHTML = ubicaciones.map(function (u) {
      return '<option value="' + u.codigo + '">' + escapeHtml(u.nombre) + '</option>';
    }).join('');
    if (valorSeleccionado) selectEl.value = valorSeleccionado;
  }

  // ============================================================================
  //  Autenticación
  // ============================================================================
  function iniciarApp() {
    document.getElementById('view-login').classList.add('oculto');
    document.getElementById('view-app').classList.remove('oculto');
    document.getElementById('tb-rol').textContent = estado.rol;
    aplicarVisibilidadRoles();
    ubicacionesCache = null;
    mostrarVista('home');
  }

  function aplicarVisibilidadRoles() {
    var esAdmin = estado.rol === 'Admin';
    var puedeAjustar = estado.rol === 'Supervisor' || estado.rol === 'Admin';
    document.querySelectorAll('[data-rol-admin]').forEach(function (el) { el.classList.toggle('oculto', !esAdmin); });
    document.querySelectorAll('[data-rol-ajuste]').forEach(function (el) { el.classList.toggle('oculto', !puedeAjustar); });
    var campoUsuario = document.getElementById('hi-usuario');
    if (campoUsuario) {
      var envoltorio = campoUsuario.closest('.ancho') || campoUsuario.parentElement;
      if (envoltorio) envoltorio.classList.toggle('oculto', estado.rol === 'Operativo');
    }
  }

  function cerrarSesionLocal() {
    try { localStorage.removeItem('inv_token'); } catch (e) {}
    detenerCamara();
    estado = { token: null, usuario: null, nombre: null, rol: null, idUsuario: null };
    productoActual = null;
    document.getElementById('li-usuario').value = '';
    document.getElementById('li-pin').value = '';
    limpiarMensaje('login-msg');
    document.getElementById('view-app').classList.add('oculto');
    document.getElementById('view-login').classList.remove('oculto');
  }

  // ============================================================================
  //  Escaneo de QR (cámara nativa BarcodeDetector, con respaldo ZXing)
  // ============================================================================
  function iniciarCamara() {
    detenerCamara();
    var video = document.getElementById('scanner-video');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mostrarMensaje('scan-msg', 'CÁMARA NO DISPONIBLE — Usa el campo de texto para escribir el código manualmente.', 'warn');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      estadoCamara.stream = stream;
      video.srcObject = stream;
      return video.play();
    }).then(function () {
      if ('BarcodeDetector' in window) {
        estadoCamara.detector = new BarcodeDetector({ formats: ['qr_code'] });
        loopDeteccionNativa();
      } else {
        cargarZXingYEscanear();
      }
    }).catch(function () {
      mostrarMensaje('scan-msg', 'CÁMARA NO DISPONIBLE — Usa el campo de texto para escribir el código manualmente.', 'warn');
    });
  }

  function detenerCamara() {
    if (estadoCamara.raf) { cancelAnimationFrame(estadoCamara.raf); estadoCamara.raf = null; }
    if (estadoCamara.zxingControls) { try { estadoCamara.zxingControls.stop(); } catch (e) {} estadoCamara.zxingControls = null; }
    if (estadoCamara.stream) { estadoCamara.stream.getTracks().forEach(function (t) { t.stop(); }); estadoCamara.stream = null; }
  }

  function loopDeteccionNativa() {
    var video = document.getElementById('scanner-video');
    if (!estadoCamara.stream) return; // la cámara ya se detuvo
    estadoCamara.detector.detect(video).then(function (codigos) {
      if (codigos && codigos.length) {
        onCodigoLeido(codigos[0].rawValue);
        return;
      }
      estadoCamara.raf = requestAnimationFrame(loopDeteccionNativa);
    }).catch(function () {
      estadoCamara.raf = requestAnimationFrame(loopDeteccionNativa);
    });
  }

  function cargarZXingYEscanear() {
    if (window.ZXing) { escanearConZXing(); return; }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    script.onload = escanearConZXing;
    script.onerror = function () {
      mostrarMensaje('scan-msg', 'CÁMARA NO DISPONIBLE — Usa el campo de texto para escribir el código manualmente.', 'warn');
    };
    document.head.appendChild(script);
  }

  function escanearConZXing() {
    try {
      var lector = new ZXing.BrowserQRCodeReader();
      lector.decodeFromVideoDevice(undefined, 'scanner-video', function (resultado, error, controls) {
        estadoCamara.zxingControls = controls;
        if (resultado) onCodigoLeido(resultado.getText());
      });
    } catch (e) {
      mostrarMensaje('scan-msg', 'CÁMARA NO DISPONIBLE — Usa el campo de texto para escribir el código manualmente.', 'warn');
    }
  }

  function onCodigoLeido(valor) {
    var ahora = Date.now();
    if (valor === ultimoCodigoLeido && (ahora - ultimoCodigoTiempo) < 2000) return;
    ultimoCodigoLeido = valor; ultimoCodigoTiempo = ahora;
    detenerCamara();
    buscarProducto(valor.trim());
  }

  function buscarProducto(idQr) {
    limpiarMensaje('scan-msg');
    callServer('buscarProductoPorQr', [estado.token, { idQr: idQr }], function (producto) {
      productoActual = producto;
      renderProducto(producto);
      mostrarVista('product');
    }, function (msg) { mostrarMensaje('scan-msg', msg, 'error'); });
  }

  function renderProducto(p) {
    document.getElementById('pd-idqr').textContent = p.idQr;
    document.getElementById('pd-descripcion').textContent = p.descripcion;
    document.getElementById('pd-codigo').textContent = p.codigo;
    document.getElementById('pd-color').textContent = p.color || '—';
    document.getElementById('pd-lote').textContent = p.lote || '—';
    document.getElementById('pd-unidad').textContent = p.unidad;
    document.getElementById('pd-proveedor').textContent = p.proveedor || '—';
    var pill = document.getElementById('pd-estado');
    pill.textContent = p.estado;
    pill.className = 'estado-pill ' + (p.estado === 'Activo' ? 'activo' : 'inactivo');
    ['A', 'B', 'C', 'D', 'E'].forEach(function (k) { document.getElementById('pd-stock-' + k).textContent = p.stock[k]; });
    document.getElementById('pd-stock-total').textContent = p.stock.total;
  }

  // ============================================================================
  //  Formularios de movimiento
  // ============================================================================
  function abrirFormularioMovimiento(tipo) {
    if (!productoActual) { mostrarVista('scan'); return; }
    cargarUbicacionesSiHaceFalta(function () {
      if (tipo === 'entrada') prepararEntrada();
      else if (tipo === 'salida') prepararSalida();
      else if (tipo === 'transferencia') prepararTransferencia();
      else if (tipo === 'ajuste') prepararAjuste();
      mostrarVista(tipo);
    });
  }

  function nombreCorto_() { return productoActual.descripcion + ' · Lote ' + (productoActual.lote || '—'); }

  function prepararEntrada() {
    document.getElementById('en-nombre').textContent = nombreCorto_();
    llenarSelectUbicaciones(document.getElementById('en-ubicacion'), ubicacionesCache);
    document.getElementById('en-cantidad').value = '';
    document.getElementById('en-observacion').value = '';
    limpiarMensaje('en-msg');
  }

  function prepararSalida() {
    document.getElementById('sa-nombre').textContent = nombreCorto_();
    ['A', 'B', 'C', 'D', 'E'].forEach(function (k) { document.getElementById('sa-stock-' + k).textContent = productoActual.stock[k]; });
    llenarSelectUbicaciones(document.getElementById('sa-ubicacion'), ubicacionesCache);
    document.getElementById('sa-cantidad').value = '';
    document.getElementById('sa-observacion').value = '';
    limpiarMensaje('sa-msg');
  }

  function prepararTransferencia() {
    document.getElementById('tr-nombre').textContent = nombreCorto_();
    llenarSelectUbicaciones(document.getElementById('tr-origen'), ubicacionesCache);
    llenarSelectUbicaciones(document.getElementById('tr-destino'), ubicacionesCache);
    document.getElementById('tr-cantidad').value = '';
    document.getElementById('tr-observacion').value = '';
    limpiarMensaje('tr-msg');
    actualizarDisponibleTransferencia();
  }

  function prepararAjuste() {
    document.getElementById('aj-nombre').textContent = nombreCorto_();
    llenarSelectUbicaciones(document.getElementById('aj-ubicacion'), ubicacionesCache);
    document.getElementById('aj-cantidad').value = '';
    document.getElementById('aj-observacion').value = '';
    document.getElementById('aj-sentido').value = 'Incremento';
    document.getElementById('aj-motivo').value = 'Diferencia de inventario';
    limpiarMensaje('aj-msg');
    actualizarStockActualAjuste();
  }

  function actualizarDisponibleTransferencia() {
    if (!productoActual) return;
    var cod = document.getElementById('tr-origen').value;
    document.getElementById('tr-disponible').textContent = productoActual.stock[cod] || 0;
  }

  function actualizarStockActualAjuste() {
    if (!productoActual) return;
    var cod = document.getElementById('aj-ubicacion').value;
    document.getElementById('aj-actual').textContent = productoActual.stock[cod] || 0;
  }

  function mostrarResultado(tipoTexto, resultado, sufijo) {
    document.getElementById('res-detalle').textContent = ' ' + tipoTexto + ' registrada correctamente' + (sufijo || '') + '.';
    document.getElementById('res-folio').textContent = resultado.idMovimiento;
    ['A', 'B', 'C', 'D', 'E'].forEach(function (k) { document.getElementById('res-stock-' + k).textContent = resultado.stock[k]; });
    if (productoActual) productoActual.stock = resultado.stock;
    mostrarVista('resultado');
  }

  // ============================================================================
  //  Consultas: stock, por ubicación, historial, resumen
  // ============================================================================
  function buscarStock(codigo) {
    callServer('consultarStock', [estado.token, { codigo: codigo }], function (filas) {
      renderTablaStock(filas);
    }, function (msg) { document.getElementById('st-resultados').innerHTML = '<div class="msg-error"><b>Error</b>' + escapeHtml(msg) + '</div>'; });
  }

  function renderTablaStock(filas) {
    var cont = document.getElementById('st-resultados');
    if (!filas.length) { cont.innerHTML = '<div class="vacio">No hay resultados.</div>'; return; }
    cont.innerHTML = filas.map(function (f) {
      return '<div class="card">' +
        '<div class="producto-nombre" style="font-size:15px;">' + escapeHtml(f.descripcion) + '</div>' +
        '<div class="producto-id">' + escapeHtml(f.codigo) + ' · Lote ' + escapeHtml(f.lote || '—') + ' · ' + escapeHtml(f.idQr) + '</div>' +
        '<div class="stock-barra">' + ['A', 'B', 'C', 'D', 'E'].map(function (k) { return '<div><span>' + k + '</span><b>' + f[k] + '</b></div>'; }).join('') + '</div>' +
        '<div style="text-align:center;color:var(--text-muted);font-size:12.5px;">Total: <b class="cantidad">' + f.total + '</b></div>' +
        '</div>';
    }).join('');
  }

  function prepararTabsUbicacion() {
    cargarUbicacionesSiHaceFalta(function () {
      var cont = document.getElementById('ub-tabs');
      cont.innerHTML = ubicacionesCache.map(function (u, i) {
        return '<button data-tab-ubicacion="' + u.codigo + '" class="' + (i === 0 ? 'activo' : '') + '">' + escapeHtml(u.nombre) + '</button>';
      }).join('');
      if (ubicacionesCache.length) cargarUbicacionStock(ubicacionesCache[0].codigo);
      else document.getElementById('ub-resultados').innerHTML = '<div class="vacio">No hay ubicaciones activas.</div>';
    });
  }

  function cargarUbicacionStock(codigo) {
    callServer('consultarPorUbicacion', [estado.token, { ubicacion: codigo }], function (res) {
      renderListaUbicacion(res);
    }, function (msg) { document.getElementById('ub-resultados').innerHTML = '<div class="msg-error"><b>Error</b>' + escapeHtml(msg) + '</div>'; });
  }

  function renderListaUbicacion(res) {
    var cont = document.getElementById('ub-resultados');
    if (!res.items.length) { cont.innerHTML = '<div class="vacio">Esta ubicación no tiene stock registrado.</div>'; return; }
    var filas = res.items.map(function (it) {
      return '<div class="lista-item"><div><div class="principal">' + escapeHtml(it.descripcion) + '</div>' +
        '<div class="secundario">' + escapeHtml(it.codigo) + ' · Lote ' + escapeHtml(it.lote || '—') + '</div></div>' +
        '<div class="cantidad">' + it.cantidad + '</div></div>';
    }).join('');
    cont.innerHTML = '<div class="card">' + filas +
      '<div class="lista-item total-fila"><div class="principal">Total</div><div class="cantidad">' + res.total + '</div></div></div>';
  }

  function cargarHistorial(filtros) {
    callServer('historialMovimientos', [estado.token, filtros || {}], function (filas) {
      renderTablaHistorial(filas);
    }, function (msg) { document.getElementById('hi-resultados').innerHTML = '<div class="msg-error"><b>Error</b>' + escapeHtml(msg) + '</div>'; });
  }

  function renderTablaHistorial(filas) {
    var cont = document.getElementById('hi-resultados');
    if (!filas.length) { cont.innerHTML = '<div class="vacio">Sin movimientos con esos filtros.</div>'; return; }
    var filasHtml = filas.map(function (m) {
      var ubic = m.tipo === 'Transferencia' ? (m.ubicacionOrigen + ' → ' + m.ubicacionDestino) : (m.ubicacionDestino || m.ubicacionOrigen || '—');
      var signo = (m.ubicacionDestino && !m.ubicacionOrigen) ? '+' : ((m.ubicacionOrigen && !m.ubicacionDestino) ? '-' : '');
      return '<tr><td>' + m.fecha + '<br><span style="color:var(--text-muted);font-size:11px;">' + m.hora + '</span></td>' +
        '<td>' + m.tipo + '</td>' +
        '<td>' + escapeHtml(m.descripcion) + '<br><span style="color:var(--text-muted);font-size:11px;">' + escapeHtml(m.lote || '') + '</span></td>' +
        '<td>' + ubic + '</td>' +
        '<td class="cantidad">' + signo + m.cantidad + ' ' + m.unidad + '</td>' +
        '<td>' + escapeHtml(m.usuario) + '</td></tr>';
    }).join('');
    cont.innerHTML = '<div class="card tabla-wrap"><table class="tabla"><thead><tr>' +
      '<th>Fecha</th><th>Tipo</th><th>Producto</th><th>Ubicación</th><th>Cant.</th><th>Usuario</th>' +
      '</tr></thead><tbody>' + filasHtml + '</tbody></table></div>';
  }

  function cargarResumen() {
    callServer('resumenStock', [estado.token], function (res) {
      renderResumen(res);
    }, function (msg) { document.getElementById('re-contenido').innerHTML = '<div class="msg-error"><b>Error</b>' + escapeHtml(msg) + '</div>'; });
  }

  function renderResumen(res) {
    var unidades = Object.keys(res.porUnidad);
    var bloques = unidades.map(function (u) {
      var d = res.porUnidad[u];
      return '<div class="card">' +
        '<div class="resumen-total"><div class="num">' + formatearNumero_(d.total) + '</div><div class="unidad">' + escapeHtml(u) + ' en total</div></div>' +
        '<div class="stock-barra">' + ['A', 'B', 'C', 'D', 'E'].map(function (k) { return '<div><span>' + k + '</span><b>' + d[k] + '</b></div>'; }).join('') + '</div>' +
        '</div>';
    }).join('');
    document.getElementById('re-contenido').innerHTML =
      '<div class="card" style="text-align:center;"><span style="color:var(--text-muted);font-size:12.5px;">Productos activos</span>' +
      '<div style="font-family:var(--font-mono);font-size:26px;font-weight:700;">' + res.productosActivos + '</div></div>' +
      (bloques || '<div class="vacio">Todavía no hay stock registrado.</div>');
  }

  // ============================================================================
  //  Administración: productos / QR
  // ============================================================================
  var temporizadorBusquedaProductos = null;

  function cargarListaProductos(filtroTexto) {
    callServer('listarProductos', [estado.token, { query: filtroTexto || '', soloActivos: false }], function (lista) {
      renderListaProductos(lista);
    }, function (msg) { document.getElementById('pr-lista').innerHTML = '<div class="msg-error"><b>Error</b>' + escapeHtml(msg) + '</div>'; });
  }

  function renderListaProductos(lista) {
    ultimaListaProductos = lista;
    var cont = document.getElementById('pr-lista');
    actualizarContadorSeleccion_();
    if (!lista.length) { cont.innerHTML = '<div class="vacio">No hay productos.</div>'; return; }
    cont.innerHTML = '<div class="card">' + lista.map(function (p) {
      var marcado = !!productosSeleccionados[p.idQr];
      return '<div class="lista-item">' +
        '<label style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;">' +
        '<input type="checkbox" class="chk-producto" data-idqr="' + p.idQr + '"' + (marcado ? ' checked' : '') + '>' +
        '<span style="min-width:0;"><div class="principal">' + escapeHtml(p.descripcion) +
        ' <span class="estado-pill ' + (p.estado === 'Activo' ? 'activo' : 'inactivo') + '">' + p.estado + '</span></div>' +
        '<div class="secundario">' + escapeHtml(p.codigo) + ' · Lote ' + escapeHtml(p.lote || '—') + ' · ' + p.idQr + '</div></span>' +
        '</label>' +
        '<div class="acciones"><button class="btn btn-chico" data-toggle-producto="' + p.idQr + '" data-estado="' + p.estado + '">' +
        (p.estado === 'Activo' ? 'Desactivar' : 'Activar') + '</button></div></div>';
    }).join('') + '</div>';
  }

  function actualizarContadorSeleccion_() {
    var n = Object.keys(productosSeleccionados).length;
    var btn = document.getElementById('btn-imprimir-planilla');
    if (btn) btn.textContent = n ? '🖨️ Imprimir planilla (' + n + ')' : '🖨️ Imprimir planilla';
  }

  // ============================================================================
  //  Administración: ubicaciones
  // ============================================================================
  function cargarListaUbicacionesAdmin() {
    callServer('listarUbicaciones', [estado.token, { soloActivas: false }], function (lista) {
      ubicacionesCache = null; // refrescar caché de formularios la próxima vez que se use
      renderListaUbicacionesAdmin(lista);
    }, function (msg) { document.getElementById('ua-lista').innerHTML = '<div class="msg-error"><b>Error</b>' + escapeHtml(msg) + '</div>'; });
  }

  function renderListaUbicacionesAdmin(lista) {
    var cont = document.getElementById('ua-lista');
    if (!lista.length) { cont.innerHTML = '<div class="vacio">No hay ubicaciones.</div>'; return; }
    cont.innerHTML = '<div class="card">' + lista.map(function (u) {
      return '<div class="lista-item"><div><div class="principal">' + escapeHtml(u.nombre) +
        ' <span class="estado-pill ' + (u.estado === 'Activo' ? 'activo' : 'inactivo') + '">' + u.estado + '</span></div>' +
        '<div class="secundario">Código ' + escapeHtml(u.codigo) + '</div></div>' +
        '<div class="acciones"><button class="btn btn-chico" data-toggle-ubicacion="' + u.codigo + '" data-estado="' + u.estado + '">' +
        (u.estado === 'Activo' ? 'Desactivar' : 'Activar') + '</button></div></div>';
    }).join('') + '</div>';
  }

  // ============================================================================
  //  Administración: usuarios
  // ============================================================================
  function cargarListaUsuarios() {
    callServer('listarUsuarios', [estado.token], function (lista) {
      renderListaUsuarios(lista);
    }, function (msg) { document.getElementById('us-lista').innerHTML = '<div class="msg-error"><b>Error</b>' + escapeHtml(msg) + '</div>'; });
  }

  function renderListaUsuarios(lista) {
    var cont = document.getElementById('us-lista');
    if (!lista.length) { cont.innerHTML = '<div class="vacio">No hay usuarios.</div>'; return; }
    cont.innerHTML = '<div class="card">' + lista.map(function (u) {
      return '<div class="lista-item"><div><div class="principal">' + escapeHtml(u.nombre) +
        ' <span class="estado-pill ' + (u.estado === 'Activo' ? 'activo' : 'inactivo') + '">' + u.estado + '</span></div>' +
        '<div class="secundario">' + escapeHtml(u.usuario) + ' · ' + escapeHtml(u.rol) + '</div></div>' +
        '<div class="acciones">' +
        '<button class="btn btn-chico" data-pin-usuario="' + u.idUsuario + '" data-nombre-usuario="' + escapeHtml(u.nombre) + '">PIN</button>' +
        '<button class="btn btn-chico" data-toggle-usuario="' + u.idUsuario + '" data-estado="' + u.estado + '">' +
        (u.estado === 'Activo' ? 'Desactivar' : 'Activar') + '</button>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  // ============================================================================
  //  Generación e impresión de etiquetas QR
  // ============================================================================
  function mostrarQrProducto(p) {
    document.getElementById('qrcode-canvas-wrap').innerHTML = '';
    new QRCode(document.getElementById('qrcode-canvas-wrap'), { text: p.idQr, width: 180, height: 180 });
    document.getElementById('pr-qr-codigo').textContent = p.codigo + (p.lote ? (' · Lote ' + p.lote) : '');
    document.getElementById('pr-qr-descripcion').textContent = p.descripcion;
    document.getElementById('pr-qr-lote').textContent = 'ID: ' + p.idQr;
    document.getElementById('pr-qr-card').classList.remove('oculto');
    ['pr-codigo', 'pr-descripcion', 'pr-color', 'pr-unidad', 'pr-lote', 'pr-proveedor'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    limpiarMensaje('pr-msg');
    cargarListaProductos('');
  }

  function generarQrDataUrl_(idQr, tamano) {
    var contenedor = document.getElementById('qr-temp-oculto');
    if (!contenedor) {
      contenedor = document.createElement('div');
      contenedor.id = 'qr-temp-oculto';
      contenedor.style.position = 'fixed';
      contenedor.style.left = '-9999px';
      contenedor.style.top = '0';
      document.body.appendChild(contenedor);
    }
    contenedor.innerHTML = '';
    new QRCode(contenedor, { text: idQr, width: tamano, height: tamano });
    var canvas = contenedor.querySelector('canvas');
    return canvas ? canvas.toDataURL('image/png') : '';
  }

  /** Arma una planilla A4 de etiquetas QR, 3 columnas x 4 filas (12 por hoja), y abre el diálogo de impresión. */
  function imprimirPlanillaQr(productos) {
    if (!productos.length) { window.alert('Marca al menos un producto de la lista para imprimir su planilla de QR.'); return; }
    var celdas = productos.map(function (p) {
      var dataUrl = generarQrDataUrl_(p.idQr, 200);
      return '<div class="etiqueta">' +
        '<img src="' + dataUrl + '">' +
        '<div class="cod">' + escapeHtml(p.codigo) + '</div>' +
        '<div class="desc">' + escapeHtml(p.descripcion) + '</div>' +
        '<div class="lote">Lote ' + escapeHtml(p.lote || '—') + ' · ' + p.idQr + '</div>' +
        '</div>';
    });
    var hojas = '';
    for (var i = 0; i < celdas.length; i += 12) {
      var grupo = celdas.slice(i, i + 12);
      while (grupo.length < 12) grupo.push('<div class="etiqueta vacia"></div>');
      hojas += '<div class="hoja">' + grupo.join('') + '</div>';
    }
    var win = window.open('', '_blank');
    if (!win) { window.alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.'); return; }
    win.document.write(
      '<html><head><title>Planilla de QR</title><style>' +
      '@page { size: A4; margin: 10mm; }' +
      '*{box-sizing:border-box;} body{font-family:sans-serif;margin:0;}' +
      '.hoja{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);gap:4mm;width:100%;height:277mm;page-break-after:always;}' +
      '.hoja:last-child{page-break-after:auto;}' +
      '.etiqueta{border:1px dashed #999;border-radius:6px;padding:4mm;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;}' +
      '.etiqueta.vacia{border:none;}' +
      '.etiqueta img{width:28mm;height:28mm;}' +
      '.etiqueta .cod{font-weight:bold;font-size:12px;margin-top:2mm;}' +
      '.etiqueta .desc{font-size:10.5px;}' +
      '.etiqueta .lote{font-size:9px;color:#666;margin-top:1mm;}' +
      '</style></head><body>' + hojas + '</body></html>'
    );
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 400);
  }

  // ============================================================================
  //  Inicialización: eventos y arranque de sesión
  // ============================================================================

  // --- Login ---
  document.getElementById('btn-login').addEventListener('click', function () {
    var btn = this;
    limpiarMensaje('login-msg');
    var usuario = document.getElementById('li-usuario').value.trim();
    var pin = document.getElementById('li-pin').value.trim();
    if (!usuario || !pin) { mostrarMensaje('login-msg', 'DATOS INCOMPLETOS — Ingresa usuario y PIN.', 'warn'); return; }
    btn.disabled = true;
    callServer('login', [{ usuario: usuario, pin: pin }], function (res) {
      btn.disabled = false;
      estado.token = res.token; estado.usuario = res.usuario; estado.nombre = res.nombre;
      estado.rol = res.rol; estado.idUsuario = res.idUsuario;
      try { localStorage.setItem('inv_token', res.token); } catch (e) {}
      iniciarApp();
    }, function (msg) { btn.disabled = false; mostrarMensaje('login-msg', msg, 'error'); });
  });
  document.getElementById('li-pin').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  });

  document.getElementById('btn-logout').addEventListener('click', function () {
    callServer('logout', [estado.token], cerrarSesionLocal, cerrarSesionLocal);
  });

  // --- Navegación genérica ---
  document.querySelectorAll('[data-ir]').forEach(function (btn) {
    btn.addEventListener('click', function () { mostrarVista(btn.dataset.ir); });
  });
  document.querySelectorAll('[data-mov]').forEach(function (btn) {
    btn.addEventListener('click', function () { abrirFormularioMovimiento(btn.dataset.mov); });
  });
  document.querySelectorAll('[data-volver]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var destino = btn.dataset.volver;
      if (destino === 'product' && productoActual) renderProducto(productoActual);
      mostrarVista(destino);
    });
  });
  document.getElementById('btn-otro-escaneo').addEventListener('click', function () { mostrarVista('scan'); });

  // --- Escaneo manual ---
  document.getElementById('btn-scan-manual').addEventListener('click', function () {
    var v = document.getElementById('scan-manual').value.trim().toUpperCase();
    if (!v) { mostrarMensaje('scan-msg', 'DATOS INCOMPLETOS — Escribe o escanea un código.', 'warn'); return; }
    buscarProducto(v);
  });
  document.getElementById('scan-manual').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('btn-scan-manual').click();
  });

  // --- Cambios que afectan disponibilidad mostrada ---
  document.getElementById('tr-origen').addEventListener('change', actualizarDisponibleTransferencia);
  document.getElementById('aj-ubicacion').addEventListener('change', actualizarStockActualAjuste);

  // --- Confirmar movimientos ---
  document.getElementById('btn-confirmar-entrada').addEventListener('click', function () {
    var btn = this; limpiarMensaje('en-msg');
    var payload = {
      idQr: productoActual.idQr, ubicacion: document.getElementById('en-ubicacion').value,
      cantidad: document.getElementById('en-cantidad').value, observacion: document.getElementById('en-observacion').value
    };
    btn.disabled = true;
    callServer('registrarEntrada', [estado.token, payload], function (res) {
      btn.disabled = false; mostrarResultado('Entrada', res, ' en ' + payload.ubicacion);
    }, function (msg) { btn.disabled = false; mostrarMensaje('en-msg', msg, 'error'); });
  });

  document.getElementById('btn-confirmar-salida').addEventListener('click', function () {
    var btn = this; limpiarMensaje('sa-msg');
    var payload = {
      idQr: productoActual.idQr, ubicacion: document.getElementById('sa-ubicacion').value,
      cantidad: document.getElementById('sa-cantidad').value, observacion: document.getElementById('sa-observacion').value
    };
    btn.disabled = true;
    callServer('registrarSalida', [estado.token, payload], function (res) {
      btn.disabled = false; mostrarResultado('Salida', res, ' desde ' + payload.ubicacion);
    }, function (msg) { btn.disabled = false; mostrarMensaje('sa-msg', msg, 'error'); });
  });

  document.getElementById('btn-confirmar-transferencia').addEventListener('click', function () {
    var btn = this; limpiarMensaje('tr-msg');
    var payload = {
      idQr: productoActual.idQr, origen: document.getElementById('tr-origen').value,
      destino: document.getElementById('tr-destino').value, cantidad: document.getElementById('tr-cantidad').value,
      observacion: document.getElementById('tr-observacion').value
    };
    btn.disabled = true;
    callServer('registrarTransferencia', [estado.token, payload], function (res) {
      btn.disabled = false; mostrarResultado('Transferencia', res, ' de ' + payload.origen + ' a ' + payload.destino);
    }, function (msg) { btn.disabled = false; mostrarMensaje('tr-msg', msg, 'error'); });
  });

  document.getElementById('btn-confirmar-ajuste').addEventListener('click', function () {
    var btn = this; limpiarMensaje('aj-msg');
    var payload = {
      idQr: productoActual.idQr, ubicacion: document.getElementById('aj-ubicacion').value,
      sentido: document.getElementById('aj-sentido').value, motivo: document.getElementById('aj-motivo').value,
      cantidad: document.getElementById('aj-cantidad').value, observacion: document.getElementById('aj-observacion').value
    };
    btn.disabled = true;
    callServer('registrarAjuste', [estado.token, payload], function (res) {
      btn.disabled = false; mostrarResultado('Ajuste', res, ' en ' + payload.ubicacion);
    }, function (msg) { btn.disabled = false; mostrarMensaje('aj-msg', msg, 'error'); });
  });

  // --- Consulta de stock ---
  document.getElementById('btn-buscar-stock').addEventListener('click', function () {
    buscarStock(document.getElementById('st-buscar').value.trim());
  });
  document.getElementById('st-buscar').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('btn-buscar-stock').click();
  });

  // --- Consulta por ubicación ---
  document.getElementById('ub-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tab-ubicacion]');
    if (!btn) return;
    document.querySelectorAll('#ub-tabs button').forEach(function (b) { b.classList.remove('activo'); });
    btn.classList.add('activo');
    cargarUbicacionStock(btn.dataset.tabUbicacion);
  });

  // --- Historial ---
  document.getElementById('btn-filtrar-historial').addEventListener('click', function () {
    cargarHistorial({
      fechaDesde: document.getElementById('hi-desde').value,
      fechaHasta: document.getElementById('hi-hasta').value,
      tipo: document.getElementById('hi-tipo').value,
      codigo: document.getElementById('hi-codigo').value.trim(),
      usuario: document.getElementById('hi-usuario').value.trim()
    });
  });

  // --- Admin: productos ---
  document.getElementById('btn-crear-producto').addEventListener('click', function () {
    var btn = this; limpiarMensaje('pr-msg');
    var payload = {
      codigo: document.getElementById('pr-codigo').value.trim(),
      descripcion: document.getElementById('pr-descripcion').value.trim(),
      color: document.getElementById('pr-color').value.trim(),
      unidad: document.getElementById('pr-unidad').value.trim(),
      lote: document.getElementById('pr-lote').value.trim(),
      proveedor: document.getElementById('pr-proveedor').value.trim()
    };
    btn.disabled = true;
    callServer('crearProductoLote', [estado.token, payload], function (p) {
      btn.disabled = false; mostrarQrProducto(p);
    }, function (msg) { btn.disabled = false; mostrarMensaje('pr-msg', msg, 'error'); });
  });

  document.getElementById('pr-buscar').addEventListener('input', function () {
    var valor = this.value;
    if (temporizadorBusquedaProductos) clearTimeout(temporizadorBusquedaProductos);
    temporizadorBusquedaProductos = setTimeout(function () { cargarListaProductos(valor.trim()); }, 300);
  });

  document.getElementById('pr-lista').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-toggle-producto]');
    if (!btn) return;
    var nuevoEstado = btn.dataset.estado === 'Activo' ? 'Inactivo' : 'Activo';
    callServer('cambiarEstadoProducto', [estado.token, { idQr: btn.dataset.toggleProducto, estado: nuevoEstado }], function () {
      cargarListaProductos(document.getElementById('pr-buscar').value.trim());
    }, function (msg) { mostrarMensaje('pr-msg', msg, 'error'); });
  });

  document.getElementById('pr-lista').addEventListener('change', function (e) {
    var chk = e.target.closest('.chk-producto');
    if (!chk) return;
    var p = ultimaListaProductos.filter(function (x) { return x.idQr === chk.dataset.idqr; })[0];
    if (!p) return;
    if (chk.checked) productosSeleccionados[p.idQr] = p; else delete productosSeleccionados[p.idQr];
    actualizarContadorSeleccion_();
  });

  document.getElementById('btn-seleccionar-todos-productos').addEventListener('click', function () {
    var todosMarcados = ultimaListaProductos.length > 0 && ultimaListaProductos.every(function (p) { return !!productosSeleccionados[p.idQr]; });
    ultimaListaProductos.forEach(function (p) {
      if (todosMarcados) delete productosSeleccionados[p.idQr]; else productosSeleccionados[p.idQr] = p;
    });
    renderListaProductos(ultimaListaProductos);
  });

  document.getElementById('btn-imprimir-planilla').addEventListener('click', function () {
    imprimirPlanillaQr(Object.keys(productosSeleccionados).map(function (k) { return productosSeleccionados[k]; }));
  });

  document.getElementById('btn-descargar-qr').addEventListener('click', function () {
    var canvas = document.querySelector('#qrcode-canvas-wrap canvas');
    if (!canvas) return;
    var link = document.createElement('a');
    link.download = document.getElementById('pr-qr-lote').textContent.replace('ID: ', '') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  document.getElementById('btn-imprimir-qr').addEventListener('click', function () {
    var canvas = document.querySelector('#qrcode-canvas-wrap canvas');
    if (!canvas) return;
    var win = window.open('', '_blank');
    if (!win) return;
    win.document.write(
      '<html><head><title>Etiqueta</title><style>' +
      'body{font-family:sans-serif;text-align:center;padding:24px;} img{width:200px;height:200px;}' +
      '.c{font-weight:bold;margin-top:10px;font-size:15px;} .d{font-size:14px;margin-top:2px;} .l{font-size:12px;color:#666;margin-top:2px;}' +
      '</style></head><body>' +
      '<img src="' + canvas.toDataURL('image/png') + '">' +
      '<div class="c">' + document.getElementById('pr-qr-codigo').textContent + '</div>' +
      '<div class="d">' + document.getElementById('pr-qr-descripcion').textContent + '</div>' +
      '<div class="l">' + document.getElementById('pr-qr-lote').textContent + '</div>' +
      '</body></html>'
    );
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 300);
  });

  // --- Admin: ubicaciones ---
  document.getElementById('btn-crear-ubicacion').addEventListener('click', function () {
    var btn = this; limpiarMensaje('ua-msg');
    var payload = { codigo: document.getElementById('ua-codigo').value.trim(), nombre: document.getElementById('ua-nombre').value.trim() };
    btn.disabled = true;
    callServer('crearUbicacion', [estado.token, payload], function (lista) {
      btn.disabled = false;
      document.getElementById('ua-codigo').value = ''; document.getElementById('ua-nombre').value = '';
      ubicacionesCache = null;
      renderListaUbicacionesAdmin(lista);
    }, function (msg) { btn.disabled = false; mostrarMensaje('ua-msg', msg, 'error'); });
  });

  document.getElementById('ua-lista').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-toggle-ubicacion]');
    if (!btn) return;
    var nuevoEstado = btn.dataset.estado === 'Activo' ? 'Inactivo' : 'Activo';
    callServer('cambiarEstadoUbicacion', [estado.token, { codigo: btn.dataset.toggleUbicacion, estado: nuevoEstado }], function (lista) {
      ubicacionesCache = null;
      renderListaUbicacionesAdmin(lista);
    }, function (msg) { mostrarMensaje('ua-msg', msg, 'error'); });
  });

  // --- Admin: usuarios ---
  document.getElementById('btn-crear-usuario').addEventListener('click', function () {
    var btn = this; limpiarMensaje('us-msg');
    var payload = {
      usuario: document.getElementById('us-usuario').value.trim(),
      nombre: document.getElementById('us-nombre').value.trim(),
      rol: document.getElementById('us-rol').value,
      pin: document.getElementById('us-pin').value.trim()
    };
    btn.disabled = true;
    callServer('crearUsuario', [estado.token, payload], function (lista) {
      btn.disabled = false;
      document.getElementById('us-usuario').value = ''; document.getElementById('us-nombre').value = ''; document.getElementById('us-pin').value = '';
      renderListaUsuarios(lista);
    }, function (msg) { btn.disabled = false; mostrarMensaje('us-msg', msg, 'error'); });
  });

  document.getElementById('us-lista').addEventListener('click', function (e) {
    var btnEstado = e.target.closest('[data-toggle-usuario]');
    if (btnEstado) {
      var nuevoEstado = btnEstado.dataset.estado === 'Activo' ? 'Inactivo' : 'Activo';
      callServer('cambiarEstadoUsuario', [estado.token, { idUsuario: btnEstado.dataset.toggleUsuario, estado: nuevoEstado }], function (lista) {
        renderListaUsuarios(lista);
      }, function (msg) { mostrarMensaje('us-msg', msg, 'error'); });
      return;
    }
    var btnPin = e.target.closest('[data-pin-usuario]');
    if (btnPin) {
      var nuevoPin = window.prompt('Nuevo PIN (4 a 6 dígitos) para ' + btnPin.dataset.nombreUsuario + ':');
      if (nuevoPin === null) return;
      callServer('cambiarPin', [estado.token, { idUsuario: btnPin.dataset.pinUsuario, nuevoPin: nuevoPin }], function () {
        mostrarMensaje('us-msg', 'PIN ACTUALIZADO — Se guardó el nuevo PIN correctamente.', 'ok');
      }, function (msg) { mostrarMensaje('us-msg', msg, 'error'); });
    }
  });

  // --- Admin: auditoría ---
  document.getElementById('btn-recalcular-stock').addEventListener('click', function () {
    if (!window.confirm('¿Recalcular todo el stock desde el historial de movimientos? Esto no borra nada, solo vuelve a sumar todo desde cero.')) return;
    var btn = this; limpiarMensaje('au-msg'); btn.disabled = true;
    callServer('recalcularStockCompleto', [estado.token], function (res) {
      btn.disabled = false;
      mostrarMensaje('au-msg', 'LISTO — Se recalculó el stock de ' + res.actualizados + ' producto(s)/lote(s).', 'ok');
    }, function (msg) { btn.disabled = false; mostrarMensaje('au-msg', msg, 'error'); });
  });

  // ============================================================================
  //  Arranque: restaurar sesión guardada, si la hay
  // ============================================================================
  (function arrancar() {
    var tokenGuardado = null;
    try { tokenGuardado = localStorage.getItem('inv_token'); } catch (e) {}
    if (!tokenGuardado) return;
    callServer('whoAmI', [tokenGuardado], function (sesion) {
      estado.token = tokenGuardado; estado.usuario = sesion.usuario; estado.nombre = sesion.nombre;
      estado.rol = sesion.rol; estado.idUsuario = sesion.idUsuario;
      iniciarApp();
    }, function () {
      try { localStorage.removeItem('inv_token'); } catch (e) {}
    });
  })();
