# Product photos

Drop product photos in this folder (JPG or PNG, ideally 800x600 or larger,
landscape), or upload them directly through the site's admin product
manager. To link a file from this folder to a product in `index.html`, add
an `img` field to its entry in the `PRODUCTS` array:

```js
{id:"lm-caps", name:"Lion's Mane Focus Capsules", ..., img:"images/lions-mane.jpg"},
```

Photos are cropped to fit automatically. Products without a photo show an
illustrated mushroom tile. Only use photos you own or have a license to use.
