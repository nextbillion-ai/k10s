export const Common = {
  validateOptions (options, list) {
    for (const item of list) {
      if (!options[item]) {
        throw new Error(`missing Resource option: ${item}`)
      }
    }
  },
  /**
   *
   * @param {*} obj
   * @param {*} clazz
   */
  assertType (obj, clazz) {

  }
}
