# Product photos

Drop product photos in this folder (JPG or PNG, ideally 800×600 or larger,
landscape). Then link one to a product in `index.html` by adding an `img`
field to its entry in the `PRODUCTS` array:

```js
{id:"lm-caps", name:"Lion's Mane Focus Capsules", ..., img:"images/lions-mane.jpg"},
```

Photos are cropped to fit automatically. Products without an `img` field
keep the illustrated mushroom tile, so you can add photos one at a time.
Only use photos you own or have a license to use.
