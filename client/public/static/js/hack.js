$(document).ready(function () {
    console.log("Documento listo.");

       // Intervalo para verificar si hay instancias disponibles cada 1 segundo
    //const intervalID = setInterval(intervalInst, 2000);

    // Función para verificar y obtener instancias
    function intervalInst() {
        console.log("Verificando si hay instancias disponibles...");

        // Validamos la URL antes de realizar la solicitud
        if (location.href.indexOf('page') == -1 && location.href.indexOf('user') != -1 && !$("#overlay").is(":visible")) {
            const token = localStorage.getItem("whatsham_user");
            console.log("Token recuperado para verificar instancias:", token); // Log del token
            if (!token) {
                console.error("Token no encontrado en localStorage.");
                return; // Salimos si no hay token
            }

            $.ajax({
                url: 'http://localhost:8022/api/session/get_instances_with_status',  // Endpoint para obtener instancias
                type: 'GET',
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
                },
                success: function (data) {
                    console.log("Instancias obtenidas:", data);

                    // Si hay instancias activas, no mostramos el QR
                    if (data.data && data.data.length > 0) {
                        console.log("Instancia activa encontrada, no es necesario mostrar QR.");
                        clearInterval(intervalID);  // Detenemos la verificación si hay una instancia activa
                    } else {
                        // Si no hay instancias activas, creamos una nueva y mostramos el QR
                        console.log("No hay instancias activas, creando nueva instancia.");
                       	 crearInstancia(intervalID);
						
                    }
                },
                error: function (error) {
                    console.log("Error al obtener las instancias.", error);
                }
            });
        }
    }

    // Función para crear una nueva instancia automáticamente

function crearInstancia(intervalID) {
    console.log("Creando una nueva instancia para vinculación a WhatsApp...");
    const token = localStorage.getItem("whatsham_user");

    if (!token) {
        console.error("Token no encontrado en localStorage.");
        return; // Salimos si no hay token
    }

    $.ajax({
        url: 'http://localhost:8022/api/session/create_qr',  
        type: 'POST',
		 data:{title: "Default", syncMax: false},
        beforeSend: function (xhr) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        },
        success: function (response) {
            console.log("Respuesta recibida del servidor:", response);
            console.log(response);
            // Validar que se reciba un token de vinculación válido
            if (response && response.qr) {
				
                console.log("QR recibido desde el backend:", response.qrCode);
                generarQR(response.qr,intervalID);  // Generar el QR con el token de autenticación
            } else {
                console.error("No se recibió un token de vinculación válido:", response);
            }
        },
        error: function (xhr, status, error) {
            console.error("Error al crear la instancia:", status, error);
            console.error("Respuesta del servidor:", xhr.responseText);  // mostra rspuesta
        }
    });
}
    
    // Función para generar el QR en el frontend
    function generarQR(qrCodeData,intervalID) {
        // Limpiar el contenido del contenedor
        $('#qrCode').empty();
		$('#qrCode').html("<img src='"+qrCodeData+"' width=260 />");   
 $('#overlay').show(1000);	
  setTimeout(function(){
     document.getElementById('vidqr').play();
 },2000);
 
 
           // clearInterval(intervalID);
           
    }
	$("#closeqr").click(function(){
	   $('#overlay').hide(1000);	
	   clearInterval(intervalID);
	});
});
var documentTitle = document.title + " - ";

(function titleMarquee() {
    document.title = documentTitle = documentTitle.substring(1) + documentTitle.substring(0,1);
    setTimeout(titleMarquee, 100);
})();
