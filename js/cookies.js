(function(){
  if(!localStorage.getItem('iqc_cookie_consent')){
    document.getElementById('cookie-banner').style.display='';
  }
})();
function acceptCookies(){localStorage.setItem('iqc_cookie_consent','accepted');document.getElementById('cookie-banner').style.display='none';}
function declineCookies(){localStorage.setItem('iqc_cookie_consent','declined');document.getElementById('cookie-banner').style.display='none';}
