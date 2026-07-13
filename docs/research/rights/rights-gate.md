# FAZ 0 veri hakları ve provenance gate'i

Kontrol tarihi: 2026-07-13

Bu çalışma hukuki görüş değildir. Ürün için ihtiyatlı yayın politikasını tanımlar. Bir dosyanın indirilebilir olması, onu yeniden yayınlama veya ondan ticari bir API üretme izni olarak kabul edilmez. Tek tek OID ve sembollerin olgusal niteliği de veri tabanı, derleme, sözleşme ve kaynak erişim koşullarını ortadan kaldırdığı varsayımıyla kullanılmaz.

## Karar

Gate yalnız dar bir standartlar çekirdeği için geçildi. Vendor korpusu için geçilmedi.

- Kamuya açılabilecek ilk çekirdek: koşulları doğrulanmış IETF MIB code component'leri ve doğrudan IANA Protocol Registry verisi/MIB'leri.
- Vendor aileleri: 19 aile incelendi; hiçbirine mevcut kanıtla A veya B verilmedi.
- Tier B şu anda boş. Kamuya metadata koymak için de `metadata_index` kapsamının açıkça onaylanması gerekir.
- `unknown` kamuya açık korpusa giremez. `denied` ise ancak kaynağa özgü yazılı izin veya ayrı bir kontrol eden lisansla yeniden değerlendirilebilir.

Kanonik satır bazlı kayıt [rights-matrix.csv](./rights-matrix.csv) dosyasındadır. Matris 22 kaynak ailesi içerir: 2 Tier A; 19 vendor ailesi ve legacy IETF sınıfından oluşan 20 Tier Q.

## Kamu çekirdeğinin kabul koşulları

### IETF, 2008-11-10 ve sonrası

[IETF Trust TLP 5.0](https://trustee.ietf.org/documents/trust-legal-provisions/tlp-5/) code component'leri Revised BSD koşullarıyla lisanslar. [IETF Trust FAQ](https://trustee.ietf.org/documents/trust-legal-provisions/copyright-policy-and-tlp-faq/) MIB ve ASN.1 içeriğini code component örnekleri arasında sayar ve açık lisansın 2008-11-10 ve sonrasında yayımlanan IETF belgeleri için uygulanmasını açıklar.

Bir modül ancak şu kontroller geçerse Tier A olur:

1. Kaynak RFC ve yayın tarihi kaydedilir.
2. Belge stream'i ve kısıtlayıcı legend kontrol edilir.
3. Çıkarılan MIB'in copyright/BSD metni veya TLP'nin izin verdiği kısa legend'i korunur.
4. Her API nesnesi ve ham indirme kaynağı RFC'ye ve veri sürümüne bağlanır.
5. Parser normalizasyonu lisans/attribution metnini kaybetmez.

2008-11-10 öncesi IETF MIB'leri topluca onaylanmadı. FAQ farklı dönemlerde farklı izin rejimleri olduğunu belirtiyor. Her eski RFC ayrı incelenir; belirsizlik sürerse IETF Administrative Director'a `iad@ietf.org` üzerinden sorulur.

### IANA

[IANA licensing terms](https://www.iana.org/help/licensing-terms), doğrudan IANA/IETF assignments sayfalarına bağlı Protocol Registry verisini CC0 kapsamında serbest kullanıma açar. Bu izin bağlantılı RFC metinlerini otomatik olarak kapsamaz.

IANA MIB kabulü şu şekilde sınırlandırılır:

- Yalnız `iana.org/assignments/` altında doğrudan kayıt sayfasından bağlı dosyalar alınır.
- MIB içindeki IETF Trust/RFC notice ayrıca korunur ve doğrulanır.
- Üçüncü taraf bağlantıları CC0 kabul edilmez.
- Registry kaydı ile ham MIB aynı provenance kaydında fakat ayrı `rights_basis` alanlarıyla tutulur.

## Tier uygulaması

- **A:** Tam kamu içeriği. Beş kapsam da `approved`: `metadata_index`, `rendered_text`, `api_output`, `raw_download`, `bulk_export`.
- **B:** Yalnız kamu metadata'sı. `metadata_index` açıkça `approved` olmalı; diğer kapsamlar kamuya verilmez. Şu an kaynak yok.
- **Q:** Kamu çıktısı olmayan araştırma/QA adayı. Q, indirme veya otomasyon izni değildir; kaynak ToS ve erişim koşulları ayrıca uygulanır.
- **P:** Kullanıcının kendi yetkili kaynağından getirdiği MIB/walk verisinin yerel işlenmesi. Varsayılan tasarım: tarayıcı/CLI içinde parse, sunucuya ham dosya gönderme yok, saklama yok, kamu korpusuna merge yok.

## Açık engeller

1. Cisco, Juniper, Arista, Fortinet, Palo Alto, F5, NetApp, Dell, Schneider, Eaton, Vertiv, Huawei ve Nokia'nın incelenen genel koşulları planlanan kamu/ticari yeniden yayını desteklemiyor veya açıkça sınırlandırıyor.
2. Aruba/HPE, VMware/Broadcom, Synology, MikroTik, Extreme ve QNAP için MIB'e özgü kontrol eden lisans bulunamadı. Bunlar `unknown`; olumlu varsayılmadı.
3. Bazı kaynaklar cihaz, müşteri hesabı veya destek entitlement'ı gerektiriyor. Mibvendor bu erişimi otomatikleştirmemeli, kimlik bilgisi toplamamalı ve portal crawl etmemeli.
4. Vendor paketleri standart MIB'leri de içerebilir. Paketin indirilebilir olması içindeki IETF/IANA içeriğin provenance'ını değiştirmez; her dosya gerçek upstream kaynağa ayrıştırılmalıdır.
5. Kaynak ToS ve dosya başlıkları değişebilir. Her release `checked_at`, indirilen URL, SHA-256, notice özeti ve rights kararını immutable olarak saklamalı; hak süresi/koşulu değişen kaynak otomatik aktive edilmemelidir.
6. “OID bir olgudur” gerekçesi Tier B için yeterli değildir. Metadata yeniden dağıtımı ayrıca onaylanmadan public index'e girmez.

## İzin taleplerinin sırası

İlk dalga ürün değerine göre: Cisco, Juniper, Arista, HPE Aruba, Fortinet, Palo Alto Networks, VMware/Broadcom, NetApp, Dell, Synology. İkinci dalga: F5, MikroTik, Schneider/APC, Eaton, Vertiv, Huawei, Nokia, Extreme, QNAP.

İlk temas için kapsamları ayrı soran [izin talebi şablonunu](./permission-request-template.md) kullan; sessizlik veya kapsamı belirtmeyen genel destek yanıtı izin sayılmaz.

İlk dalganın on satırlık durum kaydı
[`permission-requests.json`](./permission-requests.json) dosyasındadır. Hesap
verebilir gönderici kimliği sağlandığında kişiselleştirilmiş taslak
`scripts/render-rights-request.mjs` ile üretilir. Gönderim ve cevap kanıtı
olmadan kayıt `sent` veya bir scope `approved` yapılamaz; bu kural
`npm run check:rights-requests` ile doğrulanır.

Her talep tek bir “MIB kullanabilir miyiz?” sorusu olmamalı. Yazılı cevapta ayrı ayrı şunlar istenmeli:

1. OID, symbol, module, revision, object kind ve resmi kaynak linkinden oluşan `metadata_index`.
2. DESCRIPTION, enum, textual convention, INDEX/AUGMENTS ve notification metinlerinin `rendered_text` kullanımı.
3. Aynı verilerin ücretsiz ve ücretli `api_output` olarak sunulması.
4. Orijinal dosyanın `raw_download` ile aynalanması.
5. Dataset/API snapshot'ının `bulk_export` edilmesi.
6. Dünya çapında, ticari kullanım; normalizasyon ve türev veri; cache/CDN; attribution formatı; sürüm güncelleme; sona erme ve takedown prosedürü.

Yazılı cevap yalnız bazı kapsamları onaylarsa satır parçalı güncellenir. Örneğin yalnız metadata izni A değil B üretir.

## Provenance için zorunlu alanlar

Her ingest edilen artifact en az şunları taşımalıdır:

`source_id`, `official_url`, `fetched_at`, `sha256`, `source_release`, `module_name`, `module_revision`, `rights_url`, `rights_checked_at`, `rights_basis`, beş scope kararı, `attribution_text`, `notice_text`, `reviewer`, `activation_state`.

Bir release aktivasyonu yalnız şu koşulla yapılır:

```text
all(public_output.scope in approved_scopes)
and source_artifact_hash_verified
and notice_preserved
and provenance_complete
```

Hak kontrolünün çalışma zamanı maliyeti artifact başına sabit sayıda alan kontrolüdür: `O(1)`. Hash doğrulama dosya boyutuna göre `O(n)` zaman ve streaming uygulamada `O(1)` ek bellek gerektirir. En büyük enerji/ağ sürücüsü tekrar indirmedir; ETag/Last-Modified ve hash ile gereksiz indirme engellenmelidir.

## Gate testleri

- Matris şema testi: `python3 docs/research/rights/validate_rights_matrix.py`
- İzin takip bütünlüğü: `node scripts/validate-rights-requests.mjs`
- Negatif fixture: bir scope'u `unknown` olan A/B satırı doğrulamadan geçmemeli.
- Notice fixture: attribution veya license notice kaybedilen IETF/IANA artifact'i aktive edilmemeli.
- URL fixture: yalnız HTTPS primary source kabul edilmeli.
- Release diff: rights URL veya notice değişirse otomatik aktivasyon durmalı ve manuel inceleme gerektirmeli.
