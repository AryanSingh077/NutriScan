let html5QrCode;

const statusText = document.getElementById("status-text");
const scanLine = document.getElementById("scan-line");
const resultCard = document.getElementById("result-card");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");

function startCamera() {
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
    }

    startBtn.style.display = "none";
    stopBtn.style.display = "inline-block";
    resultCard.style.display = "none";
    scanLine.style.display = "block";
    statusText.innerText = "Point camera at a barcode...";

    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            stopCamera(); 
            statusText.innerText = "Scanned Code: " + decodedText;
            fetchData(decodedText);
        },
        (errorMessage) => {
        }
    ).catch(err => {
        console.error(err);
        statusText.innerText = "Camera Error: " + err;
        stopCamera();
    });
}

function stopCamera() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
        }).catch(err => console.log(err));
    }
    startBtn.style.display = "inline-block";
    stopBtn.style.display = "none";
    scanLine.style.display = "none";
}

async function fetchData(barcode) {
    statusText.innerText = "🔍 Fetching Product Details...";
    resultCard.style.display = "none"; 

    try {
        const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
        const data = await response.json();

        if (data.status === 1) {
            const product = data.product;
            statusText.innerText = "✅ Analysis Complete"; 
            resultCard.style.display = "block";
            
            document.getElementById("product-name").innerText = product.product_name || "Unknown Product";
            document.getElementById("product-brand").innerText = product.brands || "Brand Not Listed";

            const imgElement = document.getElementById("product-img");
            imgElement.src = product.image_url || product.image_front_url || "https://via.placeholder.com/150?text=No+Photo+Available";

            const n = product.nutriments || {};
            
            const kcal = n['energy-kcal_100g'];
            const sugar = n.sugars_100g;
            const fat = n.fat_100g;
            const salt = n.salt_100g;

            document.getElementById("kcal-val").innerText = kcal !== undefined ? Math.round(kcal) + " kcal" : "N/A";
            document.getElementById("sugar-val").innerText = sugar !== undefined ? sugar.toFixed(1) + "g" : "N/A";
            document.getElementById("fat-val").innerText = fat !== undefined ? fat.toFixed(1) + "g" : "N/A";
            document.getElementById("salt-val").innerText = salt !== undefined ? salt.toFixed(1) + "g" : "N/A";

            const verdictBox = document.getElementById("verdict-box");
            verdictBox.className = "verdict"; 

            if (sugar === undefined && fat === undefined) {
                verdictBox.innerText = "⚪ DATA INCOMPLETE";
                verdictBox.style.background = "#95a5a6";
            } else {
                let alerts = [];
                if (sugar > 15) alerts.push("SUGAR");
                if (fat > 20) alerts.push("FAT");
                
                if (alerts.length > 0) {
                    verdictBox.innerText = `🔴 HIGH ${alerts.join(" & ")}`;
                    verdictBox.classList.add("red");
                } else if (sugar > 5 || fat > 3) {
                    verdictBox.innerText = "🟡 MODERATE CHOICE";
                    verdictBox.classList.add("yellow");
                } else {
                    verdictBox.innerText = "🟢 HEALTHY CHOICE";
                    verdictBox.classList.add("green");
                }
            }
        } else {
            statusText.innerText = `❌ This barcode (${barcode}) is not in our database yet.`;
        }
    } catch (err) {
        statusText.innerText = "❌ Network Error. Check your connection.";
    }
}