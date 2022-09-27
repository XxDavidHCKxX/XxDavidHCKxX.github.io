function paises(){
    var paises = parseFloat
    (document.getElementById('clases').value);
    switch(paises)
    {
        case 1:
            document.getElementById('resultado').value = 'Math';
            break;
        case 2:
            document.getElementById('resultado').value = 'Physics';
            break;
        case 3:
            document.getElementById('resultado').value = 'Chemistry';
            break;
        case 4:
            document.getElementById('resultado').value = 'Redes Informatica';
            break;
        case 5:
            document.getElementById('resultado').value = 'Programacion';
            break;
        case 6:
            document.getElementById('resultado').value = 'Diseño Web';
            break;
        case 7:
            document.getElementById('resultado').value = 'Diseño Grafico';
            break;
        case 8:
            document.getElementById('resultado').value = 'Biologia';
            break;
        case 9:
            document.getElementById('resultado').value = 'Biblia';
            break;
        case 10:
            document.getElementById('resultado').value = 'Contabilidad';
            break;
        case 11:
            document.getElementById('resultado').value = 'Mantenimiento y Reparacion de Computadoras';
            break;
        default:
            document.getElementById('resultado').value = 'No definido el valor';
            break;
    }
}